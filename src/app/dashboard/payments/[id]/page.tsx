'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

type PIStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SENT_TO_ERP'
  | 'CONFIRMED' | 'CANCELLED' | 'FAILED' | 'AMENDMENT_PENDING'

type AmendmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
type AmendmentField  = 'AMOUNT' | 'ENTITY' | 'BANK_ACCOUNT'

interface Version {
  id: string; version: number; amount: number; currency: string
  bankAccountId: string; entityId: string; dueDate: string | null
  glCode: string | null; costCentre: string | null
  snapshotAt: string; changeReason: string | null
  snapshotByUser: { name: string | null; email: string } | null
}

interface Amendment {
  id: string; field: AmendmentField; previousValue: string; proposedValue: string
  status: AmendmentStatus; requestedAt: string; reviewedAt: string | null
  rejectionReason: string | null; notes: string | null
  requestedByUser: { name: string | null; email: string } | null
  reviewedByUser:  { name: string | null; email: string } | null
}

interface PIDetail {
  id:               string
  invoiceId:        string
  entityId:         string
  bankAccountId:    string
  amount:           number
  currency:         string
  status:           PIStatus
  currentVersion:   number
  dueDate:          string | null
  glCode:           string | null
  costCentre:       string | null
  poReference:      string | null
  erpReference:     string | null
  confirmedAmount:  number | null
  notes:            string | null
  cancellationReason: string | null
  approvedAt:       string | null
  sentToErpAt:      string | null
  confirmedAt:      string | null
  cancelledAt:      string | null
  createdAt:        string
  updatedAt:        string
  entity:      { id: string; name: string } | null
  invoice:     { id: string; invoiceNo: string; amount: number; currency: string; status: string } | null
  bankAccount: { id: string; label: string; accountName: string; accountNo: string; currency: string; paymentRail: string } | null
  creator:     { id: string; name: string | null; email: string } | null
  approver:    { id: string; name: string | null; email: string } | null
  versions:    Version[]
  amendments:  Amendment[]
}

const STATUS_COLOR: Record<PIStatus, { bg: string; text: string }> = {
  DRAFT:             { bg: '#f8fafc', text: '#64748b' },
  PENDING_APPROVAL:  { bg: '#fff7ed', text: '#ea580c' },
  APPROVED:          { bg: '#f0fdf4', text: '#16a34a' },
  SENT_TO_ERP:       { bg: '#eff6ff', text: '#2563eb' },
  CONFIRMED:         { bg: '#f0fdf4', text: '#15803d' },
  CANCELLED:         { bg: '#fef2f2', text: '#dc2626' },
  FAILED:            { bg: '#fef2f2', text: '#dc2626' },
  AMENDMENT_PENDING: { bg: '#fdf4ff', text: '#9333ea' },
}

const STATUS_LABEL: Record<PIStatus, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved',
  SENT_TO_ERP: 'Sent to ERP', CONFIRMED: 'Confirmed', CANCELLED: 'Cancelled',
  FAILED: 'Failed', AMENDMENT_PENDING: 'Amendment Pending',
}

const AMEND_FIELD_LABEL: Record<AmendmentField, string> = {
  AMOUNT: 'Amount', ENTITY: 'Entity', BANK_ACCOUNT: 'Bank Account',
}

const AMEND_STATUS_COLOR: Record<AmendmentStatus, { bg: string; text: string }> = {
  PENDING:   { bg: '#fff7ed', text: '#ea580c' },
  APPROVED:  { bg: '#f0fdf4', text: '#16a34a' },
  REJECTED:  { bg: '#fef2f2', text: '#dc2626' },
  CANCELLED: { bg: '#f8fafc', text: '#64748b' },
}

function fmtAmt(v: number | null, currency: string) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDateShort(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PaymentDetailPage() {
  const user   = useUser()
  const params = useParams()
  const id     = params.id as string

  const [pi,       setPi]       = useState<PIDetail | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [acting,   setActing]   = useState(false)

  // Action modals
  const [approveModal,  setApproveModal]  = useState(false)
  const [rejectModal,   setRejectModal]   = useState(false)
  const [cancelModal,   setCancelModal]   = useState(false)
  const [amendModal,    setAmendModal]    = useState(false)
  const [approveAmendModal, setApproveAmendModal] = useState<Amendment | null>(null)

  const [approveNotes,   setApproveNotes]   = useState('')
  const [rejectNotes,    setRejectNotes]    = useState('')
  const [cancelReason,   setCancelReason]   = useState('')
  const [amendField,     setAmendField]     = useState<AmendmentField>('AMOUNT')
  const [amendValue,     setAmendValue]     = useState('')
  const [amendNotes,     setAmendNotes]     = useState('')
  const [amendDecision,  setAmendDecision]  = useState<'APPROVED' | 'REJECTED'>('APPROVED')
  const [rejectAmendReason, setRejectAmendReason] = useState('')

  const APPROVER_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO'])
  const WRITER_ROLES   = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])
  const CANCEL_ROLES   = new Set(['ADMIN', 'CONTROLLER', 'CFO', 'FINANCE_MANAGER'])
  const AMEND_ROLES    = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

  const canApprove = APPROVER_ROLES.has(user.role ?? '') && pi?.status === 'PENDING_APPROVAL' && pi?.creator?.id !== user.id
  const canSubmit  = WRITER_ROLES.has(user.role ?? '')   && pi?.status === 'DRAFT'
  const canCancel  = CANCEL_ROLES.has(user.role ?? '')   && pi && !['CONFIRMED','CANCELLED','FAILED'].includes(pi.status)
  const canAmend   = AMEND_ROLES.has(user.role ?? '')    && pi && ['APPROVED','SENT_TO_ERP'].includes(pi.status)
  const canSendErp = APPROVER_ROLES.has(user.role ?? '') && pi?.status === 'APPROVED'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payment-instructions/${id}`)
      if (!res.ok) throw new Error('Not found')
      setPi(await res.json())
    } catch {
      setError('Payment instruction not found.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function doAction(url: string, body: object, onSuccess?: () => void) {
    setActing(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      onSuccess?.()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActing(false)
    }
  }

  async function doAmendmentDecision(amendment: Amendment, decision: 'APPROVED' | 'REJECTED', reason?: string) {
    setActing(true)
    setError(null)
    try {
      const res = await fetch(`/api/payment-instructions/${id}/amendments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amendmentId: amendment.id, decision, rejectionReason: reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setApproveAmendModal(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActing(false)
    }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error && !pi) return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error}</div>
  if (!pi) return null

  const col = STATUS_COLOR[pi.status]

  const inputStyle = {
    border: '1px solid var(--border)', color: 'var(--ink)',
    background: 'var(--surface)', outline: 'none',
  }

  // Build timeline events
  const timeline = [
    { label: 'Created',       at: pi.createdAt,   by: pi.creator },
    ...(pi.approvedAt   ? [{ label: 'Approved',    at: pi.approvedAt,  by: pi.approver }] : []),
    ...(pi.sentToErpAt  ? [{ label: 'Sent to ERP', at: pi.sentToErpAt, by: null }] : []),
    ...(pi.confirmedAt  ? [{ label: 'Confirmed',   at: pi.confirmedAt, by: null }] : []),
    ...(pi.cancelledAt  ? [{ label: 'Cancelled',   at: pi.cancelledAt, by: null }] : []),
  ]

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--muted)' }}>
        <Link href="/dashboard/payments" className="hover:underline">Payments</Link>
        <span>/</span>
        <span style={{ color: 'var(--ink)' }}>{pi.invoice?.invoiceNo ?? id}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
              Payment Instruction
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: col.bg, color: col.text }}>
              {STATUS_LABEL[pi.status]}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: '#f1f5f9', color: '#64748b' }}>
              v{pi.currentVersion}
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {pi.entity?.name} · Invoice{' '}
            <Link href={`/dashboard/invoices/${pi.invoiceId}`}
              className="hover:underline" style={{ color: '#2563eb' }}>
              {pi.invoice?.invoiceNo}
            </Link>
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap justify-end">
          {canSubmit && (
            <button onClick={() => doAction(`/api/payment-instructions/${id}/submit`, {})}
              disabled={acting}
              className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
              style={{ background: '#2563eb', color: '#fff' }}>
              Submit for Approval
            </button>
          )}
          {canApprove && (
            <>
              <button onClick={() => setApproveModal(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #16a34a33' }}>
                Approve
              </button>
              <button onClick={() => setRejectModal(true)}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262633' }}>
                Reject
              </button>
            </>
          )}
          {canSendErp && (
            <button onClick={() => doAction(`/api/payment-instructions/${id}/send-to-erp`, {})}
              disabled={acting}
              className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
              Send to ERP
            </button>
          )}
          {canAmend && (
            <button onClick={() => setAmendModal(true)}
              className="px-4 py-2 rounded-xl text-sm font-medium"
              style={{ background: '#fdf4ff', color: '#9333ea', border: '1px solid #9333ea22' }}>
              Request Amendment
            </button>
          )}
          {canCancel && (
            <button onClick={() => setCancelModal(true)}
              className="px-4 py-2 rounded-xl text-sm"
              style={{ background: 'var(--surface)', color: '#dc2626', border: '1px solid #dc262633' }}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* Cancellation notice */}
      {pi.status === 'CANCELLED' && pi.cancellationReason && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
          <span className="font-medium" style={{ color: '#dc2626' }}>Cancelled: </span>
          <span style={{ color: '#dc2626' }}>{pi.cancellationReason}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Main */}
        <div className="col-span-2 space-y-5">

          {/* Key details */}
          <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>Payment Details</h2>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                ['Amount',       fmtAmt(pi.amount, pi.currency)],
                ['Due Date',     fmtDateShort(pi.dueDate)],
                ['GL Code',      pi.glCode      ?? '—'],
                ['Cost Centre',  pi.costCentre  ?? '—'],
                ['PO Reference', pi.poReference ?? '—'],
                ['ERP Reference',pi.erpReference ?? '—'],
                ...(pi.confirmedAmount !== null
                  ? [['Confirmed Amount', fmtAmt(pi.confirmedAmount, pi.currency)]]
                  : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs font-medium mb-0.5" style={{ color: 'var(--muted)' }}>{k}</dt>
                  <dd style={{ color: 'var(--ink)' }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Pending amendments */}
          {pi.amendments.filter(a => a.status === 'PENDING').length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#fdf4ff', border: '1px solid #e9d5ff' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: '#9333ea' }}>
                Pending Amendments
              </h2>
              <div className="space-y-3">
                {pi.amendments.filter(a => a.status === 'PENDING').map(a => (
                  <div key={a.id} className="rounded-xl p-3"
                    style={{ background: '#fff', border: '1px solid #e9d5ff' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium" style={{ color: '#9333ea' }}>
                          {AMEND_FIELD_LABEL[a.field]}
                        </span>
                        <div className="text-sm mt-1" style={{ color: 'var(--ink)' }}>
                          <span style={{ color: 'var(--muted)' }}>{a.previousValue}</span>
                          {' → '}
                          <span className="font-medium">{a.proposedValue}</span>
                        </div>
                        {a.notes && <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{a.notes}</div>}
                        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          Requested by {a.requestedByUser?.name ?? a.requestedByUser?.email ?? '—'} · {fmtDateShort(a.requestedAt)}
                        </div>
                      </div>
                      {APPROVER_ROLES.has(user.role ?? '') && (
                        <div className="flex gap-2 ml-4">
                          <button onClick={() => { setApproveAmendModal(a); setAmendDecision('APPROVED') }}
                            className="px-3 py-1 rounded-lg text-xs font-medium"
                            style={{ background: '#f0fdf4', color: '#16a34a' }}>
                            Approve
                          </button>
                          <button onClick={() => { setApproveAmendModal(a); setAmendDecision('REJECTED') }}
                            className="px-3 py-1 rounded-lg text-xs font-medium"
                            style={{ background: '#fef2f2', color: '#dc2626' }}>
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Amendment history */}
          {pi.amendments.filter(a => a.status !== 'PENDING').length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Amendment History</h2>
              <div className="space-y-2">
                {pi.amendments.filter(a => a.status !== 'PENDING').map(a => {
                  const c = AMEND_STATUS_COLOR[a.status]
                  return (
                    <div key={a.id} className="flex items-start justify-between text-sm py-2"
                      style={{ borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <span className="font-medium" style={{ color: 'var(--ink)' }}>
                          {AMEND_FIELD_LABEL[a.field]}
                        </span>
                        {' '}
                        <span style={{ color: 'var(--muted)' }}>
                          {a.previousValue} → {a.proposedValue}
                        </span>
                      </div>
                      <div className="text-right ml-4">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: c.bg, color: c.text }}>
                          {a.status}
                        </span>
                        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          {fmtDateShort(a.reviewedAt)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Version history */}
          {pi.versions.length > 1 && (
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>
                Version History ({pi.versions.length})
              </h2>
              <div className="space-y-2">
                {[...pi.versions].reverse().map(v => (
                  <div key={v.id} className="flex items-start justify-between text-sm py-2"
                    style={{ borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded mr-2"
                        style={{ background: '#f1f5f9', color: '#64748b' }}>v{v.version}</span>
                      <span style={{ color: 'var(--ink)' }}>{fmtAmt(v.amount, v.currency)}</span>
                      {v.changeReason && (
                        <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>{v.changeReason}</span>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {v.snapshotByUser?.name ?? v.snapshotByUser?.email ?? '—'} · {fmtDateShort(v.snapshotAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {pi.notes && (
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Notes</h2>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{pi.notes}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Bank account */}
          {pi.bankAccount && (
            <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Bank Account
              </h3>
              <div className="space-y-1 text-sm">
                <div className="font-medium" style={{ color: 'var(--ink)' }}>{pi.bankAccount.label}</div>
                <div style={{ color: 'var(--muted)' }}>{pi.bankAccount.accountName}</div>
                <div className="font-mono text-xs" style={{ color: 'var(--muted)' }}>
                  ···{pi.bankAccount.accountNo.slice(-4)}
                </div>
                <div className="text-xs px-2 py-0.5 rounded-full inline-block mt-1"
                  style={{ background: '#eff6ff', color: '#2563eb' }}>
                  {pi.bankAccount.paymentRail}
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Timeline
            </h3>
            <div className="space-y-3">
              {timeline.map((t, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: i === timeline.length - 1 ? '#2563eb' : '#cbd5e1' }} />
                  <div className="text-xs">
                    <div className="font-medium" style={{ color: 'var(--ink)' }}>{t.label}</div>
                    <div style={{ color: 'var(--muted)' }}>{fmtDate(t.at)}</div>
                    {t.by && (
                      <div style={{ color: 'var(--muted)' }}>
                        {t.by.name ?? t.by.email}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Four-eyes notice */}
          {pi.status === 'PENDING_APPROVAL' && (
            <div className="rounded-2xl p-4" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
              <h3 className="text-xs font-semibold mb-1" style={{ color: '#ea580c' }}>Four-Eyes Control</h3>
              <p className="text-xs" style={{ color: '#92400e' }}>
                The creator cannot approve their own instruction. A CONTROLLER or CFO must review.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      {/* Approve */}
      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00000055' }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--ink)' }}>Approve Payment Instruction</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              {fmtAmt(pi.amount, pi.currency)} to {pi.entity?.name}
            </p>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink)' }}>Notes (optional)</label>
            <textarea rows={2} value={approveNotes} onChange={e => setApproveNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm resize-none"
              style={inputStyle} placeholder="Optional notes…" />
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setApproveModal(false)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button disabled={acting}
                onClick={() => doAction(`/api/payment-instructions/${id}/approve`,
                  { decision: 'APPROVED', notes: approveNotes },
                  () => setApproveModal(false))}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ background: '#16a34a', color: '#fff' }}>
                {acting ? 'Approving…' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00000055' }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--ink)' }}>Reject Payment Instruction</h2>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink)' }}>
              Reason <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea rows={3} value={rejectNotes} onChange={e => setRejectNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm resize-none"
              style={inputStyle} placeholder="Reason for rejection…" />
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setRejectModal(false)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button disabled={acting || !rejectNotes.trim()}
                onClick={() => doAction(`/api/payment-instructions/${id}/approve`,
                  { decision: 'REJECTED', notes: rejectNotes },
                  () => setRejectModal(false))}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ background: '#dc2626', color: '#fff' }}>
                {acting ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00000055' }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--ink)' }}>Cancel Payment Instruction</h2>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink)' }}>
              Reason <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea rows={3} value={cancelReason} onChange={e => setCancelReason(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm resize-none"
              style={inputStyle} placeholder="Reason for cancellation…" />
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setCancelModal(false)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Back
              </button>
              <button disabled={acting || !cancelReason.trim()}
                onClick={() => doAction(`/api/payment-instructions/${id}/cancel`,
                  { reason: cancelReason },
                  () => setCancelModal(false))}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ background: '#dc2626', color: '#fff' }}>
                {acting ? 'Cancelling…' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Amendment */}
      {amendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00000055' }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--ink)' }}>Request Amendment</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Field</label>
                <select value={amendField} onChange={e => setAmendField(e.target.value as AmendmentField)}
                  className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}>
                  <option value="AMOUNT">Amount</option>
                  <option value="ENTITY">Entity</option>
                  <option value="BANK_ACCOUNT">Bank Account</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
                  Proposed Value <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input value={amendValue} onChange={e => setAmendValue(e.target.value)}
                  placeholder={amendField === 'AMOUNT' ? 'e.g. 12500.00' : 'New value…'}
                  className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle} />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Notes</label>
                <textarea rows={2} value={amendNotes} onChange={e => setAmendNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={inputStyle} />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setAmendModal(false)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button disabled={acting || !amendValue.trim()}
                onClick={() => doAction(`/api/payment-instructions/${id}/amendments`,
                  { field: amendField, proposedValue: amendValue, notes: amendNotes || null },
                  () => { setAmendModal(false); setAmendValue(''); setAmendNotes('') })}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ background: '#9333ea', color: '#fff' }}>
                {acting ? 'Requesting…' : 'Submit Amendment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve/Reject amendment */}
      {approveAmendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00000055' }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>
              {amendDecision === 'APPROVED' ? 'Approve' : 'Reject'} Amendment
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              {AMEND_FIELD_LABEL[approveAmendModal.field]}:{' '}
              <span style={{ textDecoration: 'line-through' }}>{approveAmendModal.previousValue}</span>
              {' → '}
              <span className="font-medium">{approveAmendModal.proposedValue}</span>
            </p>
            <div className="flex gap-2 mb-4">
              {(['APPROVED', 'REJECTED'] as const).map(d => (
                <button key={d} onClick={() => setAmendDecision(d)}
                  className="px-4 py-2 rounded-xl text-sm font-medium"
                  style={{
                    background: amendDecision === d ? (d === 'APPROVED' ? '#16a34a' : '#dc2626') : 'var(--surface)',
                    color:      amendDecision === d ? '#fff' : 'var(--muted)',
                    border:     `1px solid ${amendDecision === d ? 'transparent' : 'var(--border)'}`,
                  }}>
                  {d === 'APPROVED' ? 'Approve' : 'Reject'}
                </button>
              ))}
            </div>
            {amendDecision === 'REJECTED' && (
              <>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
                  Reason <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <textarea rows={2} value={rejectAmendReason} onChange={e => setRejectAmendReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm resize-none"
                  style={inputStyle} placeholder="Reason for rejection…" />
              </>
            )}
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setApproveAmendModal(null)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button
                disabled={acting || (amendDecision === 'REJECTED' && !rejectAmendReason.trim())}
                onClick={() => doAmendmentDecision(approveAmendModal, amendDecision, rejectAmendReason)}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{
                  background: amendDecision === 'APPROVED' ? '#16a34a' : '#dc2626',
                  color: '#fff',
                }}>
                {acting ? 'Submitting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
