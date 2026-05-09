'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])

type MAStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID'

interface MAItem {
  id:       string
  amount:   number
  notes:    string | null
  invoice: {
    id:          string
    invoiceNo:   string
    amount:      number
    currency:    string
    status:      string
    invoiceDate: string | null
    entity:      { id: string; name: string }
  }
}

interface MADetail {
  id:          string
  reference:   string
  name:        string | null
  totalAmount: number
  currency:    string
  status:      MAStatus
  notes:       string | null
  createdAt:   string
  updatedAt:   string
  approvedAt:  string | null
  creator:     { id: string; name: string | null; email: string } | null
  approver:    { id: string; name: string | null; email: string } | null
  items:       MAItem[]
}

const STATUS_COLOR: Record<MAStatus, { bg: string; text: string }> = {
  DRAFT:            { bg: '#f8fafc', text: '#64748b' },
  PENDING_APPROVAL: { bg: '#fff7ed', text: '#ea580c' },
  APPROVED:         { bg: '#f0fdf4', text: '#16a34a' },
  REJECTED:         { bg: '#fef2f2', text: '#dc2626' },
  PAID:             { bg: '#eff6ff', text: '#2563eb' },
}

const STATUS_LABEL: Record<MAStatus, string> = {
  DRAFT:            'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED:         'Approved',
  REJECTED:         'Rejected',
  PAID:             'Paid',
}

function fmtAmt(v: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function MergedAuthDetailPage() {
  const user   = useUser()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const qc     = useQueryClient()

  const [acting,  setActing]  = useState(false)
  const [actError, setActError] = useState<string | null>(null)

  // Modal states
  const [showSubmitModal,  setShowSubmitModal]  = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal,  setShowRejectModal]  = useState(false)
  const [showDeleteModal,  setShowDeleteModal]  = useState(false)
  const [comments,         setComments]         = useState('')

  const queryKey = queryKeys.mergedAuthorizations.detail(id)

  const { data: ma, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/merged-authorizations/${id}`)
      if (!res.ok) throw new Error('Could not load merged authorization.')
      return res.json() as Promise<MADetail>
    },
  })

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  async function doAction(path: string, body: Record<string, unknown> = {}) {
    setActing(true)
    setActError(null)
    try {
      const res = await apiClient(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.message ?? 'Action failed')
      }
      void qc.invalidateQueries({ queryKey })
    } catch (err: unknown) {
      setActError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setActing(false)
    }
  }

  async function doApprovalDecide(decision: 'APPROVED' | 'REJECTED') {
    setActing(true)
    setActError(null)
    try {
      const res = await apiClient(`/api/approvals/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'MERGED_AUTH', decision, comments: comments || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.message ?? 'Action failed')
      }
      setShowApproveModal(false)
      setShowRejectModal(false)
      setComments('')
      void qc.invalidateQueries({ queryKey })
    } catch (err: unknown) {
      setActError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setActing(false)
    }
  }

  async function doDelete() {
    setActing(true)
    try {
      const res = await apiClient(`/api/merged-authorizations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.message ?? 'Delete failed')
      }
      router.push('/dashboard/merged-authorizations')
    } catch (err: unknown) {
      setActError(err instanceof Error ? err.message : 'Delete failed.')
      setActing(false)
    }
  }

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (isError || !ma) return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>Could not load merged authorization.</div>

  const col        = STATUS_COLOR[ma.status]
  const canSubmit  = ma.status === 'DRAFT' && new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER']).has(user.role ?? '')
  const canApprove = ma.status === 'PENDING_APPROVAL' && new Set(['ADMIN', 'CONTROLLER', 'CFO']).has(user.role ?? '')
  const canDelete  = ma.status === 'DRAFT' && new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER']).has(user.role ?? '')

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-2">
        <button onClick={() => router.back()} className="text-sm mb-3 hover:underline" style={{ color: 'var(--muted)' }}>
          ← Merged Authorizations
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold font-mono" style={{ color: 'var(--ink)' }}>{ma.reference}</h1>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: col.bg, color: col.text }}>
                {STATUS_LABEL[ma.status]}
              </span>
            </div>
            {ma.name && <p className="text-base" style={{ color: 'var(--muted)' }}>{ma.name}</p>}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {canSubmit && (
              <button onClick={() => setShowSubmitModal(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: '#2563eb', color: '#fff' }}>
                Submit for Approval
              </button>
            )}
            {canApprove && (
              <>
                <button onClick={() => setShowApproveModal(true)}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={{ background: '#16a34a', color: '#fff' }}>
                  Approve
                </button>
                <button onClick={() => setShowRejectModal(true)}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                  Reject
                </button>
              </>
            )}
            {canDelete && (
              <button onClick={() => setShowDeleteModal(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {actError && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {actError}
        </div>
      )}

      <div className="grid grid-cols-3 gap-8 mt-6">
        {/* Main — invoice list */}
        <div className="col-span-2 space-y-6">
          {/* Total */}
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>Total Amount</p>
            <p className="text-xl font-semibold" style={{ color: '#2563eb' }}>
              {fmtAmt(ma.totalAmount, ma.currency)}
            </p>
          </div>

          {/* Invoice items */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-3 flex items-center justify-between"
              style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                Invoices ({ma.items.length})
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Invoice #', 'Entity', 'Date', 'Amount', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ma.items.map((item, i) => (
                  <tr key={item.id}
                    style={{ borderBottom: i < ma.items.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/invoices/${item.invoice.id}/review`}
                        className="font-mono text-xs font-medium hover:underline" style={{ color: '#2563eb' }}>
                        {item.invoice.invoiceNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      <Link href={`/dashboard/entities/${item.invoice.entity.id}`}
                        className="hover:underline" style={{ color: 'var(--ink)' }}>
                        {item.invoice.entity.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {fmtDate(item.invoice.invoiceDate)}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ink)' }}>
                      {fmtAmt(item.amount, ma.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: '#f0fdf4', color: '#16a34a' }}>
                        {item.invoice.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {ma.notes && (
            <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--ink)' }}>Notes</h3>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{ma.notes}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Details */}
          <div className="rounded-2xl p-5 space-y-3" style={{ border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Details</h3>
            {[
              { label: 'Reference',   value: ma.reference },
              { label: 'Currency',    value: ma.currency },
              { label: 'Created',     value: fmtDateTime(ma.createdAt) },
              { label: 'Created by',  value: ma.creator?.name ?? ma.creator?.email ?? '—' },
              { label: 'Approved',    value: ma.approvedAt ? fmtDateTime(ma.approvedAt) : '—' },
              { label: 'Approved by', value: ma.approver?.name ?? ma.approver?.email ?? '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{label}</p>
                <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--ink)' }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--ink)' }}>Timeline</h3>
            <div className="space-y-3">
              {[
                { label: 'Created',  done: true,                                       ts: ma.createdAt },
                { label: 'Submitted',done: ma.status !== 'DRAFT',                      ts: null },
                { label: 'Approved', done: ['APPROVED','PAID'].includes(ma.status),    ts: ma.approvedAt },
                { label: 'Paid',     done: ma.status === 'PAID',                       ts: null },
              ].map(({ label, done, ts }) => (
                <div key={label} className="flex items-start gap-3">
                  <div className="mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-xs"
                    style={{
                      background: done ? '#16a34a' : 'var(--surface)',
                      border:     done ? 'none' : '1px solid var(--border)',
                      color:      '#fff',
                    }}>
                    {done ? '✓' : ''}
                  </div>
                  <div>
                    <p className="text-xs font-medium" style={{ color: done ? 'var(--ink)' : 'var(--muted)' }}>
                      {label}
                    </p>
                    {ts && <p className="text-xs" style={{ color: 'var(--muted)' }}>{fmtDateTime(ts)}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Submit Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Submit for Approval</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
              This batch of {ma.items.length} invoices totalling {fmtAmt(ma.totalAmount, ma.currency)} will be sent for approval.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2 rounded-xl text-sm" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button disabled={acting} onClick={async () => {
                await doAction(`/api/merged-authorizations/${id}/submit`)
                setShowSubmitModal(false)
              }} className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                {acting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Approve Batch</h2>
            <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
              Approve this merged authorization for {fmtAmt(ma.totalAmount, ma.currency)}?
            </p>
            <textarea value={comments} onChange={e => setComments(e.target.value)}
              rows={2} placeholder="Comments (optional)…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none mb-4"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowApproveModal(false); setComments('') }}
                className="px-4 py-2 rounded-xl text-sm" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button disabled={acting} onClick={() => doApprovalDecide('APPROVED')}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: '#16a34a', color: '#fff' }}>
                {acting ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Reject Batch</h2>
            <textarea value={comments} onChange={e => setComments(e.target.value)}
              rows={3} placeholder="Reason for rejection (required)…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none mb-4"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowRejectModal(false); setComments('') }}
                className="px-4 py-2 rounded-xl text-sm" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button disabled={acting || !comments.trim()} onClick={() => doApprovalDecide('REJECTED')}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: '#dc2626', color: '#fff' }}>
                {acting ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Delete Batch</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
              This will permanently delete batch {ma.reference} and release its {ma.items.length} invoices.
              This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-sm" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button disabled={acting} onClick={doDelete}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: '#dc2626', color: '#fff' }}>
                {acting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
