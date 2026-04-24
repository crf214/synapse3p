'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

type ContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'UNDER_REVIEW' | 'RENEWED'
type ContractType   = 'MASTER' | 'SOW' | 'AMENDMENT' | 'NDA' | 'SLA' | 'FRAMEWORK' | 'OTHER'

interface ContractDetail {
  id:               string
  contractNo:       string
  type:             ContractType
  status:           ContractStatus
  value:            number | null
  currency:         string
  startDate:        string | null
  endDate:          string | null
  renewalDate:      string | null
  autoRenew:        boolean
  noticePeriodDays: number
  notes:            string | null
  reviewedAt:       string | null
  createdAt:        string
  updatedAt:        string
  entity:   { id: string; name: string } | null
  owner:    { id: string; name: string | null; email: string } | null
  linkedPo: { id: string; poNumber: string; title: string; status: string } | null
  document: { id: string; title: string; storageRef: string; mimeType: string | null; fileSizeBytes: number | null; eSignStatus: string; eSignRequired: boolean; createdAt: string } | null
  invoices: { id: string; invoiceNo: string; amount: number; currency: string; status: string; invoiceDate: string | null }[]
}

const STATUS_COLOR: Record<ContractStatus, { bg: string; text: string }> = {
  DRAFT:        { bg: '#f8fafc', text: '#64748b' },
  ACTIVE:       { bg: '#f0fdf4', text: '#16a34a' },
  EXPIRED:      { bg: '#fef2f2', text: '#dc2626' },
  TERMINATED:   { bg: '#fef2f2', text: '#dc2626' },
  UNDER_REVIEW: { bg: '#fff7ed', text: '#ea580c' },
  RENEWED:      { bg: '#eff6ff', text: '#2563eb' },
}

const VALID_STATUSES: ContractStatus[] = ['DRAFT','ACTIVE','UNDER_REVIEW','RENEWED','EXPIRED','TERMINATED']

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAmt(v: number | null, currency: string) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function ContractDetailPage() {
  const user    = useUser()
  const params  = useParams()
  const id      = params.id as string

  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [editing,  setEditing]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [editData, setEditData] = useState<{
    status?: ContractStatus; value?: string; currency?: string
    startDate?: string; endDate?: string; renewalDate?: string
    autoRenew?: boolean; noticePeriodDays?: number; notes?: string
  }>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}`)
      if (!res.ok) throw new Error('Not found')
      setContract(await res.json())
    } catch {
      setError('Contract not found.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function startEdit() {
    if (!contract) return
    setEditData({
      status:           contract.status,
      value:            contract.value?.toString() ?? '',
      currency:         contract.currency,
      startDate:        contract.startDate?.split('T')[0] ?? '',
      endDate:          contract.endDate?.split('T')[0]   ?? '',
      renewalDate:      contract.renewalDate?.split('T')[0] ?? '',
      autoRenew:        contract.autoRenew,
      noticePeriodDays: contract.noticePeriodDays,
      notes:            contract.notes ?? '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editData,
          value: editData.value !== undefined && editData.value !== '' ? Number(editData.value) : null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error?.message ?? 'Failed')
      }
      setEditing(false)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error || !contract) return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error ?? 'Not found'}</div>

  const col       = STATUS_COLOR[contract.status]
  const days      = daysUntil(contract.endDate)
  const expSoon   = days !== null && days >= 0 && days <= 30
  const canWrite  = WRITE_ROLES.has(user.role ?? '')

  const inputStyle = { border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--muted)' }}>
        <Link href="/dashboard/contracts" className="hover:underline">Contracts</Link>
        <span>/</span>
        <span style={{ color: 'var(--ink)' }}>{contract.contractNo}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
              {contract.contractNo}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: col.bg, color: col.text }}>
              {contract.status.replace('_', ' ')}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs"
              style={{ background: '#f1f5f9', color: '#64748b' }}>
              {contract.type}
            </span>
          </div>
          {contract.entity && (
            <Link href={`/dashboard/entities/${contract.entity.id}`}
              className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
              {contract.entity.name}
            </Link>
          )}
        </div>
        {canWrite && !editing && (
          <div className="flex gap-2">
            <button onClick={startEdit}
              className="px-4 py-2 rounded-xl text-sm"
              style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Edit
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main content */}
        <div className="col-span-2 space-y-6">

          {/* Key terms */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>Key Terms</h2>
            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Status</label>
                    <select value={editData.status ?? ''}
                      onChange={e => setEditData(d => ({ ...d, status: e.target.value as ContractStatus }))}
                      className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}>
                      {VALID_STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Value</label>
                    <input type="number" min="0" step="0.01"
                      value={editData.value ?? ''}
                      onChange={e => setEditData(d => ({ ...d, value: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {(['startDate','endDate','renewalDate'] as const).map(f => (
                    <div key={f}>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
                        {f === 'startDate' ? 'Start' : f === 'endDate' ? 'End' : 'Renewal'}
                      </label>
                      <input type="date"
                        value={editData[f] ?? ''}
                        onChange={e => setEditData(d => ({ ...d, [f]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Notice Period (days)</label>
                    <input type="number" min="0"
                      value={editData.noticePeriodDays ?? ''}
                      onChange={e => setEditData(d => ({ ...d, noticePeriodDays: Number(e.target.value) }))}
                      className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-5">
                    <input type="checkbox" id="ar"
                      checked={editData.autoRenew ?? false}
                      onChange={e => setEditData(d => ({ ...d, autoRenew: e.target.checked }))}
                    />
                    <label htmlFor="ar" className="text-sm" style={{ color: 'var(--ink)' }}>Auto-renew</label>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Notes</label>
                  <textarea rows={3}
                    value={editData.notes ?? ''}
                    onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={inputStyle}
                  />
                </div>
                {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(false); setError(null) }}
                    className="px-4 py-2 rounded-xl text-sm"
                    style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                    Cancel
                  </button>
                  <button onClick={saveEdit} disabled={saving}
                    className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {[
                  ['Value',          fmtAmt(contract.value, contract.currency)],
                  ['Start Date',     fmtDate(contract.startDate)],
                  ['End Date',       expSoon && days !== null
                    ? `${fmtDate(contract.endDate)} (${days}d remaining)`
                    : fmtDate(contract.endDate)],
                  ['Renewal Date',   fmtDate(contract.renewalDate)],
                  ['Auto-renew',     contract.autoRenew ? 'Yes' : 'No'],
                  ['Notice Period',  `${contract.noticePeriodDays} days`],
                  ['Owner',          contract.owner?.name ?? contract.owner?.email ?? '—'],
                  ['Reviewed',       fmtDate(contract.reviewedAt)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-medium mb-0.5" style={{ color: 'var(--muted)' }}>{k}</dt>
                    <dd style={{ color: expSoon && k === 'End Date' ? '#ea580c' : 'var(--ink)' }}>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* Invoices */}
          {contract.invoices.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>
                Linked Invoices ({contract.invoices.length})
              </h2>
              <div className="space-y-2">
                {contract.invoices.map(inv => (
                  <Link key={inv.id} href={`/dashboard/invoices/${inv.id}`}
                    className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-blue-50 transition-colors"
                    style={{ border: '1px solid var(--border)' }}>
                    <div className="text-sm font-mono" style={{ color: 'var(--ink)' }}>{inv.invoiceNo}</div>
                    <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--muted)' }}>
                      <span>{fmtAmt(inv.amount, inv.currency)}</span>
                      <span>{fmtDate(inv.invoiceDate)}</span>
                      <span className="px-2 py-0.5 rounded-full"
                        style={{ background: '#f1f5f9', color: '#64748b' }}>
                        {inv.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {contract.notes && !editing && (
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Notes</h2>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{contract.notes}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Document */}
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Contract Document
            </h3>
            {contract.document ? (
              <div className="space-y-2">
                <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  {contract.document.title}
                </div>
                {contract.document.storageRef ? (
                  <div className="text-xs" style={{ color: '#2563eb' }}>
                    File attached
                  </div>
                ) : (
                  <div className="text-xs" style={{ color: '#ea580c' }}>
                    No file uploaded yet
                  </div>
                )}
                {contract.document.eSignRequired && (
                  <div className="text-xs px-2 py-0.5 rounded-full inline-block"
                    style={{ background: '#fdf4ff', color: '#9333ea' }}>
                    eSign: {contract.document.eSignStatus}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>No document linked</p>
            )}
          </div>

          {/* Linked PO */}
          {contract.linkedPo && (
            <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Linked PO
              </h3>
              <Link href={`/dashboard/purchase-orders/${contract.linkedPo.id}`}
                className="text-sm hover:underline" style={{ color: '#2563eb' }}>
                {contract.linkedPo.poNumber}
              </Link>
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                {contract.linkedPo.title}
              </div>
              <div className="text-xs mt-1 px-2 py-0.5 rounded-full inline-block"
                style={{ background: '#f1f5f9', color: '#64748b' }}>
                {contract.linkedPo.status}
              </div>
            </div>
          )}

          {/* Expiry alert */}
          {expSoon && days !== null && (
            <div className="rounded-2xl p-4" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
              <h3 className="text-xs font-semibold mb-1" style={{ color: '#ea580c' }}>Expiring Soon</h3>
              <p className="text-xs" style={{ color: '#ea580c' }}>
                {days === 0 ? 'Expires today' : `Expires in ${days} day${days !== 1 ? 's' : ''}`}
              </p>
              {contract.autoRenew && (
                <p className="text-xs mt-1" style={{ color: '#92400e' }}>Auto-renew is enabled</p>
              )}
            </div>
          )}

          {/* Meta */}
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Details
            </h3>
            <dl className="space-y-2 text-xs">
              <div>
                <dt style={{ color: 'var(--muted)' }}>Created</dt>
                <dd style={{ color: 'var(--ink)' }}>{fmtDate(contract.createdAt)}</dd>
              </div>
              <div>
                <dt style={{ color: 'var(--muted)' }}>Last updated</dt>
                <dd style={{ color: 'var(--ink)' }}>{fmtDate(contract.updatedAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
