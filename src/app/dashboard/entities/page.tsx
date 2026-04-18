'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EntityStatus      = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW' | 'OFFBOARDED'
type EntityType        = 'VENDOR' | 'CONTRACTOR' | 'PARTNER' | 'COUNTERPARTY' | 'SERVICE_PROVIDER' | 'BROKER' | 'PLATFORM' | 'FUND_SERVICE' | 'OTHER'
type OnboardingStatus  = 'NOT_STARTED' | 'IN_PROGRESS' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
type LegalStructure    = 'INDIVIDUAL' | 'COMPANY' | 'FUND' | 'TRUST' | 'GOVERNMENT' | 'OTHER'

interface EntityRow {
  id:               string
  name:             string
  slug:             string
  status:           EntityStatus
  legalStructure:   LegalStructure
  jurisdiction:     string | null
  primaryCurrency:  string
  riskScore:        number
  primaryType:      EntityType | null
  orgRelationship:  { onboardingStatus: OnboardingStatus; activeForBillPay: boolean } | null
  bankAccountCount: number
  engagementCount:  number
}

type FilterKey = 'ALL' | 'ACTIVE' | 'PENDING_REVIEW' | 'HIGH_RISK'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function riskColor(score: number): { bg: string; color: string; border: string } {
  if (score >= 7) return { bg: '#fef2f2', color: '#dc2626', border: '#dc262622' }
  if (score >= 4) return { bg: '#fffbeb', color: '#d97706', border: '#d9770622' }
  return              { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22' }
}

const STATUS_COLOR: Record<EntityStatus, { bg: string; color: string; border: string; label: string }> = {
  ACTIVE:         { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Active'         },
  INACTIVE:       { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Inactive'       },
  SUSPENDED:      { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Suspended'      },
  PENDING_REVIEW: { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Pending Review' },
  OFFBOARDED:     { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Offboarded'     },
}

const ONBOARDING_COLOR: Record<OnboardingStatus, { bg: string; color: string; border: string; label: string }> = {
  NOT_STARTED:      { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Not started'     },
  IN_PROGRESS:      { bg: '#eff6ff', color: '#2563eb', border: '#2563eb22', label: 'In progress'     },
  PENDING_APPROVAL: { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Pending approval' },
  APPROVED:         { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Approved'        },
  REJECTED:         { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Rejected'        },
}

const TYPE_LABEL: Record<EntityType, string> = {
  VENDOR:           'Vendor',
  CONTRACTOR:       'Contractor',
  PARTNER:          'Partner',
  COUNTERPARTY:     'Counterparty',
  SERVICE_PROVIDER: 'Service Provider',
  BROKER:           'Broker',
  PLATFORM:         'Platform',
  FUND_SERVICE:     'Fund Service',
  OTHER:            'Other',
}

const LEGAL_STRUCTURES = ['INDIVIDUAL', 'COMPANY', 'FUND', 'TRUST', 'GOVERNMENT', 'OTHER']
const CURRENCIES = ['USD', 'GBP', 'EUR', 'CHF', 'JPY', 'CAD', 'AUD', 'SGD']

function Badge({ bg, color, border, label }: { bg: string; color: string; border: string; label: string }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Add Entity Modal
// ---------------------------------------------------------------------------
interface AddEntityForm {
  name: string; legalStructure: string; jurisdiction: string
  primaryCurrency: string; registrationNo: string; notes: string
}

function AddEntityModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AddEntityForm>({
    name: '', legalStructure: 'COMPANY', jurisdiction: '', primaryCurrency: 'USD', registrationNo: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  function set(k: keyof AddEntityForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const labelCls = 'block text-xs font-medium mb-1'
  const inputCls = 'w-full text-sm px-3 py-2 rounded-lg outline-none transition-colors'
  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-lg rounded-2xl p-6 space-y-4"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <h2 className="font-display text-xl" style={{ color: 'var(--ink)' }}>Add entity</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className={labelCls} style={{ color: 'var(--muted)' }}>Name *</label>
            <input className={inputCls} style={inputStyle} value={form.name} onChange={set('name')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Legal structure *</label>
              <select className={inputCls} style={inputStyle} value={form.legalStructure} onChange={set('legalStructure')}>
                {LEGAL_STRUCTURES.map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Jurisdiction *</label>
              <input className={inputCls} style={inputStyle} placeholder="e.g. US, GB, KY" value={form.jurisdiction} onChange={set('jurisdiction')} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Primary currency *</label>
              <select className={inputCls} style={inputStyle} value={form.primaryCurrency} onChange={set('primaryCurrency')}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Registration No.</label>
              <input className={inputCls} style={inputStyle} value={form.registrationNo} onChange={set('registrationNo')} />
            </div>
          </div>
          <div>
            <label className={labelCls} style={{ color: 'var(--muted)' }}>Notes</label>
            <textarea className={inputCls} style={inputStyle} rows={2} value={form.notes} onChange={set('notes')} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="text-sm px-4 py-2 rounded-xl"
              style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
              style={{ background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }}>
              {saving ? 'Saving…' : 'Create entity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function EntitiesPage() {
  const { role } = useUser()
  const router   = useRouter()

  const [entities,   setEntities]   = useState<EntityRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState<FilterKey>('ALL')
  const [showAdd,    setShowAdd]    = useState(false)

  const canWrite = WRITE_ROLES.has(role ?? '')

  const fetchEntities = useCallback(() => {
    setLoading(true)
    fetch('/api/entities')
      .then(r => r.json())
      .then((d: { entities: EntityRow[] }) => setEntities(d.entities ?? []))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!ALLOWED_ROLES.has(role ?? '')) { router.replace('/dashboard'); return }
    fetchEntities()
  }, [role, router, fetchEntities])

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>

  // Filter + search
  const visible = entities.filter(e => {
    const q = search.toLowerCase()
    const matchesSearch = !q || e.name.toLowerCase().includes(q) || (e.jurisdiction ?? '').toLowerCase().includes(q)
    const matchesFilter =
      filter === 'ALL'            ? true :
      filter === 'ACTIVE'         ? e.status === 'ACTIVE' :
      filter === 'PENDING_REVIEW' ? e.status === 'PENDING_REVIEW' :
      filter === 'HIGH_RISK'      ? e.riskScore >= 7 : true
    return matchesSearch && matchesFilter
  })

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'ALL',            label: 'All'           },
    { key: 'ACTIVE',         label: 'Active'        },
    { key: 'PENDING_REVIEW', label: 'Pending Review'},
    { key: 'HIGH_RISK',      label: 'High Risk'     },
  ]

  const th = 'px-3 py-3 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-3 py-3 text-sm'

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>Entities</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Manage third-party entities, due diligence, and service engagements
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setShowAdd(true)}
            className="text-sm font-medium px-4 py-2 rounded-xl"
            style={{ background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }}>
            + Add entity
          </button>
        )}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or jurisdiction…"
          className="text-sm px-3 py-2 rounded-xl w-72 outline-none"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}
        />
        <div className="flex gap-1">
          {FILTERS.map(f => {
            const active = filter === f.key
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{
                  background: active ? '#2563eb' : 'var(--surface)',
                  color:      active ? '#fff'    : 'var(--muted)',
                  border:     active ? '1px solid #2563eb' : '1px solid var(--border)',
                }}>
                {f.label}
              </button>
            )
          })}
        </div>
        <span className="text-xs ml-auto" style={{ color: 'var(--muted)' }}>
          {visible.length} of {entities.length}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-x-auto" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full min-w-[900px]">
          <thead style={{ background: 'var(--surface)' }}>
            <tr>
              {['Name', 'Type', 'Jurisdiction', 'Risk Score', 'Status', 'Onboarding', ''].map(h => (
                <th key={h} className={th}
                  style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>
                  No entities found.
                </td>
              </tr>
            )}
            {visible.map((e, i) => {
              const rc = riskColor(e.riskScore)
              const sc = STATUS_COLOR[e.status] ?? STATUS_COLOR.ACTIVE
              const oc = e.orgRelationship ? ONBOARDING_COLOR[e.orgRelationship.onboardingStatus] : ONBOARDING_COLOR.NOT_STARTED
              return (
                <tr key={e.id} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>

                  {/* Name */}
                  <td className={td}>
                    <span className="font-medium" style={{ color: 'var(--ink)' }}>{e.name}</span>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      {e.legalStructure.charAt(0) + e.legalStructure.slice(1).toLowerCase()} · {e.primaryCurrency}
                    </div>
                  </td>

                  {/* Type */}
                  <td className={td}>
                    {e.primaryType
                      ? <Badge bg="#eff6ff" color="#2563eb" border="#2563eb22" label={TYPE_LABEL[e.primaryType]} />
                      : <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
                    }
                  </td>

                  {/* Jurisdiction */}
                  <td className={td}>
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                      {e.jurisdiction ?? '—'}
                    </span>
                  </td>

                  {/* Risk Score */}
                  <td className={td}>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full tabular-nums"
                      style={{ background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
                      {e.riskScore.toFixed(1)}
                    </span>
                  </td>

                  {/* Status */}
                  <td className={td}>
                    <Badge {...sc} />
                  </td>

                  {/* Onboarding */}
                  <td className={td}>
                    <Badge {...oc} />
                  </td>

                  {/* Actions */}
                  <td className={td}>
                    <button
                      onClick={() => router.push(`/dashboard/entities/${e.id}`)}
                      className="text-xs font-medium px-2.5 py-1 rounded-lg"
                      style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
                      View
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddEntityModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); fetchEntities() }}
        />
      )}
    </div>
  )
}
