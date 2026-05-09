'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const READ_ROLES      = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const ACTION_ROLES    = new Set(['ADMIN', 'CONTROLLER', 'CFO', 'FINANCE_MANAGER'])
const PROCESS_ROLES   = new Set(['ADMIN', 'CONTROLLER', 'CFO'])

type ExecStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'RECONCILED'
type RailType   = 'ERP' | 'BANK_API' | 'STRIPE'

interface Execution {
  id:            string
  invoiceId:     string
  invoiceNo:     string
  vendorName:    string
  amount:        number
  currency:      string
  rail:          RailType
  status:        ExecStatus
  scheduledAt:   string | null
  executedAt:    string | null
  reference:     string | null
  reconciled:    boolean
  reconciledAt:  string | null
  glPosted:      boolean
  failureReason: string | null
  retryCount:    number
  createdAt:     string
  piId:          string | null
}

interface Pagination {
  page: number; totalPages: number; hasNext: boolean; hasPrev: boolean; total: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS_STYLE: Record<ExecStatus, { bg: string; color: string; border: string; label: string }> = {
  SCHEDULED:   { bg: '#eff6ff', color: '#2563eb', border: '#2563eb22', label: 'Scheduled'   },
  PROCESSING:  { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Processing'  },
  COMPLETED:   { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Completed'   },
  FAILED:      { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Failed'      },
  CANCELLED:   { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Cancelled'   },
  RECONCILED:  { bg: '#f0fdf4', color: '#15803d', border: '#15803d22', label: 'Reconciled'  },
}

const RAIL_LABEL: Record<RailType, string> = {
  ERP:      'ERP',
  BANK_API: 'Bank API',
  STRIPE:   'Stripe',
}

const STATUS_TABS: Array<{ value: ExecStatus | 'ALL'; label: string }> = [
  { value: 'ALL',       label: 'All'        },
  { value: 'SCHEDULED', label: 'Scheduled'  },
  { value: 'PROCESSING',label: 'Processing' },
  { value: 'COMPLETED', label: 'Completed'  },
  { value: 'FAILED',    label: 'Failed'     },
  { value: 'RECONCILED',label: 'Reconciled' },
]

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PaymentExecutionsPage() {
  const { role } = useUser()
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<ExecStatus | 'ALL'>('ALL')
  const [page,         setPage]         = useState(1)

  const [actioning,   setActioning]   = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [processing,  setProcessing]  = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.paymentExecutions.list({ page, statusFilter }),
    queryFn:  async () => {
      const qs  = new URLSearchParams({ page: String(page), limit: '50' })
      if (statusFilter !== 'ALL') qs.set('status', statusFilter)
      const res  = await fetch(`/api/payment-executions?${qs}`)
      const json = await res.json() as { executions: Execution[]; pagination: Pagination; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      return json
    },
  })

  const executions = data?.executions ?? []
  const pagination = data?.pagination  ?? null

  if (!role || !READ_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  async function handleRetry(id: string) {
    setActioning(id); setActionError(null)
    try {
      const res  = await apiClient(`/api/payment-executions/${id}/retry`, { method: 'POST' })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Retry failed')
      void qc.invalidateQueries({ queryKey: queryKeys.paymentExecutions.all })
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Retry failed') }
    finally { setActioning(null) }
  }

  async function handleReconcile(id: string) {
    setActioning(id); setActionError(null)
    try {
      const res  = await apiClient(`/api/payment-executions/${id}/reconcile`, { method: 'POST' })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Reconcile failed')
      void qc.invalidateQueries({ queryKey: queryKeys.paymentExecutions.all })
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Reconcile failed') }
    finally { setActioning(null) }
  }

  async function handleProcessDue() {
    setProcessing(true); setActionError(null)
    try {
      const res  = await apiClient('/api/payment-executions', { method: 'POST' })
      const json = await res.json() as { processed?: number; failed?: number; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Process failed')
      void qc.invalidateQueries({ queryKey: queryKeys.paymentExecutions.all })
      if ((json.processed ?? 0) + (json.failed ?? 0) === 0) {
        setActionError('No scheduled payments are due at this time.')
      }
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Process failed') }
    finally { setProcessing(false) }
  }

  const failedCount    = executions.filter(e => e.status === 'FAILED').length
  const scheduledCount = executions.filter(e => e.status === 'SCHEDULED').length

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/payments" className="text-sm" style={{ color: 'var(--muted)' }}>
            ← Payments
          </Link>
          <span style={{ color: 'var(--muted)' }}>/</span>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Execution Monitor</h1>
          {failedCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
              {failedCount} failed
            </span>
          )}
        </div>
        {PROCESS_ROLES.has(role) && (
          <button onClick={handleProcessDue} disabled={processing}
            className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50"
            style={{ background: '#2563eb', color: '#fff' }}>
            {processing ? 'Processing…' : `Run Due Payments${scheduledCount > 0 ? ` (${scheduledCount})` : ''}`}
          </button>
        )}
      </div>

      {/* Status tabs */}
      <div className="border-b px-6 flex gap-1"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {STATUS_TABS.map(tab => (
          <button key={tab.value}
            onClick={() => { setPage(1); setStatusFilter(tab.value) }}
            className="px-4 py-3 text-xs font-medium border-b-2 transition-colors"
            style={{
              borderBottomColor: statusFilter === tab.value ? '#2563eb' : 'transparent',
              color: statusFilter === tab.value ? '#2563eb' : 'var(--muted)',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6 max-w-6xl mx-auto">

        {actionError && (
          <div className="mb-4 text-sm px-4 py-3 rounded-lg"
            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}>
            {actionError}
          </div>
        )}

        {isLoading && <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>}
        {isError   && <p className="text-sm" style={{ color: '#dc2626' }}>{error instanceof Error ? error.message : 'Unknown error'}</p>}

        {!isLoading && executions.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>No executions found</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Payment executions appear here after a payment instruction is sent to ERP.
            </p>
          </div>
        )}

        {executions.length > 0 && (
          <>
            <div className="space-y-3">
              {executions.map(e => {
                const st = STATUS_STYLE[e.status]
                const isActioning  = actioning === e.id
                const canRetry     = ACTION_ROLES.has(role) && e.status === 'FAILED' && e.retryCount < 3
                const canReconcile = ACTION_ROLES.has(role) && e.status === 'COMPLETED' && !e.reconciled

                return (
                  <div key={e.id} className="rounded-xl p-4"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-start justify-between gap-4">

                      {/* Left */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/dashboard/invoices/${e.invoiceId}/review`}
                            className="text-sm font-semibold hover:underline" style={{ color: 'var(--ink)' }}>
                            {e.invoiceNo}
                          </Link>
                          <span className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                            {st.label}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                            {RAIL_LABEL[e.rail]}
                          </span>
                          {e.glPosted && (
                            <span className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #16a34a22' }}>
                              GL posted
                            </span>
                          )}
                        </div>

                        <div className="text-xs" style={{ color: 'var(--muted)' }}>
                          {e.vendorName} · <span className="font-medium" style={{ color: 'var(--ink)' }}>{fmt(e.amount, e.currency)}</span>
                        </div>

                        <div className="flex items-center gap-4 text-xs flex-wrap" style={{ color: 'var(--muted)' }}>
                          {e.reference && (
                            <span>Ref: <span className="font-mono" style={{ color: 'var(--ink)' }}>{e.reference}</span></span>
                          )}
                          {e.scheduledAt && (
                            <span>Scheduled: {fmtDate(e.scheduledAt)}</span>
                          )}
                          {e.executedAt && (
                            <span>Executed: {fmtDate(e.executedAt)}</span>
                          )}
                          {e.reconciledAt && (
                            <span>Reconciled: {fmtDate(e.reconciledAt)}</span>
                          )}
                          {e.retryCount > 0 && (
                            <span style={{ color: '#d97706' }}>Attempt {e.retryCount + 1} / {3 + 1}</span>
                          )}
                        </div>

                        {e.failureReason && (
                          <div className="text-xs px-3 py-2 rounded-lg"
                            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}>
                            {e.failureReason}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex-shrink-0 flex items-center gap-2">
                        {e.piId && (
                          <Link href={`/dashboard/payments/${e.piId}`}
                            className="text-xs px-3 py-1.5 rounded-lg border"
                            style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--bg)' }}>
                            View PI
                          </Link>
                        )}
                        {canRetry && (
                          <button onClick={() => handleRetry(e.id)} disabled={isActioning}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                            style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
                            {isActioning ? '…' : 'Retry'}
                          </button>
                        )}
                        {canReconcile && (
                          <button onClick={() => handleReconcile(e.id)} disabled={isActioning}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                            style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #16a34a22' }}>
                            {isActioning ? '…' : 'Reconcile'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 text-sm">
                <button onClick={() => setPage(p => p - 1)} disabled={!pagination.hasPrev}
                  className="px-3 py-1.5 rounded-lg border disabled:opacity-40"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                  Previous
                </button>
                <span style={{ color: 'var(--muted)' }}>
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
                </span>
                <button onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}
                  className="px-3 py-1.5 rounded-lg border disabled:opacity-40"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
