'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])

type InvoiceStatus = 'RECEIVED' | 'MATCHED' | 'UNMATCHED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED'
type RiskTier      = 'LOW' | 'MEDIUM' | 'HIGH'
type RiskBand      = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
type Source        = 'EMAIL' | 'PORTAL' | 'MANUAL' | 'EDI'

interface InvoiceRow {
  id:                 string
  invoiceNo:          string
  entityName:         string
  amount:             number
  currency:           string
  invoiceDate:        string
  createdAt:          string
  status:             InvoiceStatus
  source:             Source
  isRecurring:        boolean
  riskBand:           RiskBand | null
  riskTier:           RiskTier | null
  riskScore:          number | null
  riskFlags:          string[]
  decision:           string | null
  pendingApprover:    { name: string | null; email: string } | null
  needsReviewCount:   number
  duplicateFlagCount: number
}

interface Pagination { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean }

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function tierBadge(tier: RiskTier | null) {
  if (!tier) return { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: '—' }
  return {
    LOW:    { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Low'    },
    MEDIUM: { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Medium' },
    HIGH:   { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'High'   },
  }[tier]
}

function riskBandBadge(band: RiskBand | null) {
  if (!band) return null
  const map: Record<RiskBand, { bg: string; color: string; border: string; label: string }> = {
    LOW:      { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'LOW'      },
    MEDIUM:   { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'MEDIUM'   },
    HIGH:     { bg: '#fff7ed', color: '#ea580c', border: '#ea580c22', label: 'HIGH'     },
    CRITICAL: { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'CRITICAL' },
  }
  return map[band]
}

function statusBadge(s: InvoiceStatus) {
  const map: Record<InvoiceStatus, { bg: string; color: string; border: string; label: string }> = {
    RECEIVED:       { bg: '#eff6ff', color: '#2563eb', border: '#2563eb22', label: 'Received'       },
    MATCHED:        { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Matched'        },
    UNMATCHED:      { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Unmatched'      },
    PENDING_REVIEW: { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Pending Review' },
    APPROVED:       { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Approved'       },
    REJECTED:       { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Rejected'       },
    PAID:           { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Paid'           },
    CANCELLED:      { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Cancelled'      },
  }
  return map[s]
}

function sourceBadge(s: Source) {
  const map: Record<Source, { bg: string; color: string; border: string; label: string }> = {
    EMAIL:  { bg: '#eff6ff', color: '#2563eb', border: '#2563eb22', label: '✉ Email'  },
    PORTAL: { bg: '#f5f3ff', color: '#7c3aed', border: '#7c3aed22', label: '↑ Upload' },
    MANUAL: { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: '✎ Manual' },
    EDI:    { bg: '#fef3c7', color: '#92400e', border: '#92400e22', label: 'EDI'       },
  }
  return map[s]
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function Badge({ bg, color, border, label }: { bg: string; color: string; border: string; label: string }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InvoicesPage() {
  const { role } = useUser()
  const router   = useRouter()

  const [_tab,       _setTab]       = useState<'queue' | 'quarantine'>('queue')
  const [invoices,   setInvoices]   = useState<InvoiceRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  // Filters
  const [status,    setStatus]    = useState('')
  const [tier,      setTier]      = useState('')
  const [riskBand,  setRiskBand]  = useState('')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [page,      setPage]      = useState(1)

  // Merge modal
  const [merging,     setMerging]     = useState(false)
  const [mergeError,  setMergeError]  = useState<string | null>(null)

  const fetchInvoices = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const sp = new URLSearchParams({ page: String(page), limit: '50' })
      if (status)   sp.set('status',   status)
      if (tier)     sp.set('tier',     tier)
      if (riskBand) sp.set('riskBand', riskBand)
      if (dateFrom) sp.set('dateFrom', dateFrom)
      if (dateTo)   sp.set('dateTo',   dateTo)

      const res  = await fetch(`/api/invoices?${sp}`)
      const json = await res.json() as { invoices: InvoiceRow[]; pagination: Pagination; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load invoices')
      setInvoices(json.invoices)
      setPagination(json.pagination)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [page, status, tier, riskBand, dateFrom, dateTo])

  useEffect(() => { void fetchInvoices() }, [fetchInvoices])

  if (!role || !ALLOWED_ROLES.has(role)) {
    return (
      <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>
        You do not have permission to view invoices.
      </div>
    )
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === invoices.length) setSelected(new Set())
    else setSelected(new Set(invoices.map(i => i.id)))
  }

  async function startMerge() {
    if (selected.size < 2) return
    setMerging(true); setMergeError(null)
    try {
      const res  = await apiClient('/api/invoices/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: [...selected] }),
      })
      const json = await res.json() as { mergedAuth?: { id: string }; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Merge failed')
      setSelected(new Set())
      void fetchInvoices()
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="p-8 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Invoices</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Manage incoming invoices, approvals, and payment queue
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/invoices/recurring"
            className="px-3 py-2 text-sm rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            Recurring Bills
          </Link>
          <Link href="/dashboard/invoices/quarantine"
            className="px-3 py-2 text-sm rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            Quarantine
          </Link>
          <Link href="/dashboard/invoices/upload"
            className="px-3 py-2 text-sm rounded-lg font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            Upload PDF
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-5 p-4 rounded-xl"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
          <option value="">All Statuses</option>
          {['RECEIVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'MATCHED', 'UNMATCHED'].map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <select value={tier} onChange={e => { setTier(e.target.value); setPage(1) }}
          className="text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
          <option value="">All Risk Tiers</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <select value={riskBand} onChange={e => { setRiskBand(e.target.value); setPage(1) }}
          className="text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
          <option value="">All Risk Bands</option>
          <option value="LOW">Band: Low</option>
          <option value="MEDIUM">Band: Medium</option>
          <option value="HIGH">Band: High</option>
          <option value="CRITICAL">Band: Critical</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          className="text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
          placeholder="From" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
          className="text-sm px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
          placeholder="To" />
        {(status || tier || riskBand || dateFrom || dateTo) && (
          <button onClick={() => { setStatus(''); setTier(''); setRiskBand(''); setDateFrom(''); setDateTo(''); setPage(1) }}
            className="text-sm px-3 py-1.5 rounded-lg"
            style={{ color: '#dc2626' }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Merge action bar */}
      {selected.size >= 2 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-3 rounded-xl"
          style={{ background: '#eff6ff', border: '1px solid #2563eb22' }}>
          <span className="text-sm font-medium" style={{ color: '#2563eb' }}>
            {selected.size} invoices selected
          </span>
          <button onClick={startMerge} disabled={merging}
            className="text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
            style={{ background: '#2563eb', color: '#fff' }}>
            {merging ? 'Merging…' : 'Create Merged Authorization'}
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-sm px-3 py-1.5 rounded-lg"
            style={{ color: 'var(--muted)' }}>
            Clear
          </button>
          {mergeError && <span className="text-sm" style={{ color: '#dc2626' }}>{mergeError}</span>}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--muted)' }}>Loading invoices…</div>
      ) : error ? (
        <div className="py-16 text-center text-sm" style={{ color: '#dc2626' }}>{error}</div>
      ) : invoices.length === 0 ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--muted)' }}>No invoices found.</div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <th className="px-4 py-3 text-left w-10">
                  <input type="checkbox"
                    checked={selected.size === invoices.length && invoices.length > 0}
                    onChange={selectAll} />
                </th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Source</th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Vendor</th>
                <th className="px-4 py-3 text-right font-medium" style={{ color: 'var(--muted)' }}>Amount</th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Invoice #</th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Date</th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Risk Band</th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Risk Tier</th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Status</th>
                <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--muted)' }}>Context</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => {
                const band  = riskBandBadge(inv.riskBand)
                const tier  = tierBadge(inv.riskTier)
                const stat  = statusBadge(inv.status)
                const src   = sourceBadge(inv.source)
                const isEven = i % 2 === 0
                return (
                  <tr key={inv.id}
                    className="transition-colors hover:bg-blue-50 cursor-pointer"
                    style={{ background: isEven ? 'transparent' : 'var(--surface)', borderBottom: '1px solid var(--border)' }}
                    onClick={e => {
                      if ((e.target as HTMLElement).tagName === 'INPUT') return
                      router.push(`/dashboard/invoices/${inv.id}/review`)
                    }}>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(inv.id)}
                        onChange={() => toggleSelect(inv.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge {...src} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>{inv.entityName}</span>
                      {inv.isRecurring && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded"
                          style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
                          ↻
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium" style={{ color: 'var(--ink)' }}>
                      {fmt(inv.amount, inv.currency)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>
                      {inv.invoiceNo}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>
                      {new Date(inv.invoiceDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {band ? <Badge {...band} /> : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {inv.riskTier ? <Badge {...tier} /> : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge {...stat} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {inv.needsReviewCount > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: '#fffbeb', color: '#d97706' }}>
                            {inv.needsReviewCount} field{inv.needsReviewCount !== 1 ? 's' : ''} to review
                          </span>
                        )}
                        {inv.duplicateFlagCount > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: '#fef2f2', color: '#dc2626' }}>
                            ⚑ Dup flag
                          </span>
                        )}
                        {inv.pendingApprover && (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>
                            → {inv.pendingApprover.name ?? inv.pendingApprover.email}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {pagination.total} invoices · page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <button disabled={!pagination.hasPrev}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-lg border disabled:opacity-40"
              style={{ borderColor: 'var(--border)' }}>
              Previous
            </button>
            <button disabled={!pagination.hasNext}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-lg border disabled:opacity-40"
              style={{ borderColor: 'var(--border)' }}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
