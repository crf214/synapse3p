'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])

type EngStatus  = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW' | 'OFFBOARDED'
type SlaStatus  = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'NOT_APPLICABLE'
type Category   = 'BANKING' | 'CUSTODY' | 'FUND_ADMIN' | 'OUTSOURCING' | 'LEGAL' | 'AUDIT' | 'TECHNOLOGY' | 'COMPLIANCE' | 'OTHER'

interface EngRow {
  id:             string
  status:         EngStatus
  slaStatus:      SlaStatus
  slaTarget:      string | null
  department:     string | null
  contractStart:  string | null
  contractEnd:    string | null
  lastReviewedAt: string | null
  createdAt:      string
  entity:         { id: string; name: string }
  service:        { id: string; name: string; category: Category }
  owner:          { id: string; name: string | null; email: string } | null
}

const STATUS_COLOR: Record<EngStatus, { bg: string; text: string }> = {
  ACTIVE:         { bg: '#f0fdf4', text: '#16a34a' },
  INACTIVE:       { bg: '#f8fafc', text: '#64748b' },
  SUSPENDED:      { bg: '#fef2f2', text: '#dc2626' },
  PENDING_REVIEW: { bg: '#fff7ed', text: '#ea580c' },
  OFFBOARDED:     { bg: '#f1f5f9', text: '#475569' },
}

const SLA_COLOR: Record<SlaStatus, { bg: string; text: string }> = {
  ON_TRACK:       { bg: '#f0fdf4', text: '#16a34a' },
  AT_RISK:        { bg: '#fff7ed', text: '#ea580c' },
  BREACHED:       { bg: '#fef2f2', text: '#dc2626' },
  NOT_APPLICABLE: { bg: '#f8fafc', text: '#94a3b8' },
}

const STATUS_LABEL: Record<EngStatus, string> = {
  ACTIVE:         'Active',
  INACTIVE:       'Inactive',
  SUSPENDED:      'Suspended',
  PENDING_REVIEW: 'Pending Review',
  OFFBOARDED:     'Offboarded',
}

const SLA_LABEL: Record<SlaStatus, string> = {
  ON_TRACK:       'On Track',
  AT_RISK:        'At Risk',
  BREACHED:       'Breached',
  NOT_APPLICABLE: 'N/A',
}

const CATEGORIES: Category[] = ['BANKING','CUSTODY','FUND_ADMIN','OUTSOURCING','LEGAL','AUDIT','TECHNOLOGY','COMPLIANCE','OTHER']

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function ServiceEngagementsPage() {
  const user   = useUser()
  const router = useRouter()

  const [rows,      setRows]      = useState<EngRow[]>([])
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [status,    setStatus]    = useState('')
  const [slaStatus, setSlaStatus] = useState('')
  const [category,  setCategory]  = useState('')
  const [page,      setPage]      = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(page) })
    if (status)    p.set('status',    status)
    if (slaStatus) p.set('slaStatus', slaStatus)
    if (category)  p.set('category',  category)
    try {
      const res = await fetch(`/api/service-engagements?${p}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.engagements)
      setTotal(data.total)
    } catch {
      setError('Could not load service engagements.')
    } finally {
      setLoading(false)
    }
  }, [status, slaStatus, category, page])

  useEffect(() => { setPage(1) }, [status, slaStatus, category])
  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  const canWrite    = new Set(['ADMIN','FINANCE_MANAGER','CONTROLLER','CFO','LEGAL']).has(user.role ?? '')
  const breachCount = rows.filter(r => r.slaStatus === 'BREACHED').length
  const atRiskCount = rows.filter(r => r.slaStatus === 'AT_RISK').length

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Service Engagements</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {total} engagement{total !== 1 ? 's' : ''}
            {breachCount > 0 && <span style={{ color: '#dc2626' }}> · {breachCount} SLA breached</span>}
            {atRiskCount  > 0 && <span style={{ color: '#ea580c' }}> · {atRiskCount} at risk</span>}
          </p>
        </div>
        {canWrite && (
          <Link href="/dashboard/service-engagements/new"
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Engagement
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-wrap">
        {/* Status tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {(['', 'ACTIVE', 'PENDING_REVIEW', 'SUSPENDED', 'INACTIVE', 'OFFBOARDED'] as const).map(s => {
            const active = status === s
            return (
              <button key={s} onClick={() => setStatus(s)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                style={{
                  background: active ? '#2563eb' : 'var(--surface)',
                  color:      active ? '#fff'    : 'var(--muted)',
                  border:     active ? 'none'    : '1px solid var(--border)',
                }}>
                {s === '' ? 'All' : STATUS_LABEL[s]}
              </button>
            )
          })}
        </div>

        {/* SLA filter */}
        <select value={slaStatus} onChange={e => setSlaStatus(e.target.value)}
          className="px-3 py-1.5 rounded-xl text-xs outline-none"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
          <option value="">All SLA</option>
          <option value="ON_TRACK">On Track</option>
          <option value="AT_RISK">At Risk</option>
          <option value="BREACHED">Breached</option>
          <option value="NOT_APPLICABLE">N/A</option>
        </select>

        {/* Category filter */}
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="px-3 py-1.5 rounded-xl text-xs outline-none"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No service engagements found</p>
          <p className="text-sm">Track vendor and third-party service relationships here.</p>
          {canWrite && (
            <Link href="/dashboard/service-engagements/new"
              className="text-sm mt-3 inline-block" style={{ color: '#2563eb' }}>
              Add your first engagement →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Entity', 'Service', 'Category', 'Status', 'SLA', 'Contract End', 'Owner', 'Last Reviewed'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const sCol      = STATUS_COLOR[r.status]
                  const slaCol    = SLA_COLOR[r.slaStatus]
                  const days      = daysUntil(r.contractEnd)
                  const expiring  = days !== null && days >= 0 && days <= 30
                  const expired   = days !== null && days < 0

                  return (
                    <tr key={r.id}
                      onClick={() => router.push(`/dashboard/service-engagements/${r.id}`)}
                      className="cursor-pointer transition-colors hover:bg-blue-50"
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/entities/${r.entity.id}`}
                          onClick={e => e.stopPropagation()}
                          className="font-medium hover:underline" style={{ color: 'var(--ink)' }}>
                          {r.entity.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'var(--ink)' }}>
                        {r.service.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: '#f1f5f9', color: '#475569' }}>
                          {r.service.category.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: sCol.bg, color: sCol.text }}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: slaCol.bg, color: slaCol.text }}>
                          {SLA_LABEL[r.slaStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs"
                        style={{ color: expired ? '#dc2626' : expiring ? '#ea580c' : 'var(--muted)' }}>
                        {fmtDate(r.contractEnd)}
                        {expired   && <span className="ml-1 font-medium">(expired)</span>}
                        {expiring  && !expired && <span className="ml-1">({days}d)</span>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {r.owner?.name ?? r.owner?.email ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtDate(r.lastReviewedAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {total > 50 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
