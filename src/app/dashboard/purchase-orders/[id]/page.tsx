'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES   = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const APPROVER_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const AMEND_ROLES     = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const GR_ROLES        = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

type PoStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  | 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED' | 'INVOICED' | 'CLOSED' | 'CANCELLED'

interface LineItemRow {
  id: string; lineNo: number; description: string
  quantity: number; unitPrice: number; taxRate: number; totalPrice: number
  currency: string; glCode: string | null; costCentre: string | null
}

interface ApprovalRow {
  id: string; step: number; status: string
  decidedAt: string | null; comments: string | null
  approver: { id: string; name: string | null; email: string } | null
}

interface AmendmentRow {
  id: string; version: number; reason: string; amendedAt: string
  changedFields: string[]; previousValues: Record<string, unknown>; newValues: Record<string, unknown>
  actor: { name: string | null; email: string } | null
}

interface GoodsReceiptRow {
  id: string; receivedAt: string; status: string; notes: string | null
  lineItems: unknown[]
}

interface PODetail {
  id: string; poNumber: string; title: string; description: string | null
  type: string; track: string; status: PoStatus
  totalAmount: number; amountSpent: number; currency: string
  spendCategory: string | null; department: string | null; costCentre: string | null
  glCode: string | null; requiresGoodsReceipt: boolean; requiresContract: boolean
  validFrom: string | null; validTo: string | null; notes: string | null
  createdAt: string; currentVersion: number; requestedBy: string
  requestor: { id: string; name: string | null; email: string } | null
  entity: { id: string; name: string; slug: string; orgRelationships: { approvedSpendLimit: number | null }[] }
  lineItems: LineItemRow[]
  approvals: ApprovalRow[]
  amendments: AmendmentRow[]
  goodsReceipts: GoodsReceiptRow[]
  approvalWorkflow: { id: string; name: string; steps: unknown } | null
  vendorContext: {
    spendHistory:    { period: string; totalAmount: number; avgAmount: number; invoiceCount: number }[]
    recentInvoices:  { id: string; invoiceNo: string; amount: number; currency: string; invoiceDate: string; status: string }[]
    openPOCount:     number
    approvedSpendLimit: number | null
  }
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  DRAFT:              { bg: '#f9fafb', color: '#6b7280', label: 'Draft'            },
  PENDING_APPROVAL:   { bg: '#fffbeb', color: '#d97706', label: 'Pending Approval' },
  APPROVED:           { bg: '#f0fdf4', color: '#16a34a', label: 'Approved'         },
  REJECTED:           { bg: '#fef2f2', color: '#dc2626', label: 'Rejected'         },
  PARTIALLY_RECEIVED: { bg: '#eff6ff', color: '#2563eb', label: 'Part. Received'   },
  FULLY_RECEIVED:     { bg: '#f0fdf4', color: '#16a34a', label: 'Fully Received'   },
  INVOICED:           { bg: '#f5f3ff', color: '#7c3aed', label: 'Invoiced'         },
  CLOSED:             { bg: '#f9fafb', color: '#6b7280', label: 'Closed'           },
  CANCELLED:          { bg: '#f9fafb', color: '#6b7280', label: 'Cancelled'        },
}

const APPROVAL_STYLES: Record<string, { color: string; icon: string }> = {
  PENDING:   { color: '#d97706', icon: '○' },
  APPROVED:  { color: '#16a34a', icon: '✓' },
  REJECTED:  { color: '#dc2626', icon: '✕' },
  DELEGATED: { color: '#6b7280', icon: '→' },
  CANCELLED: { color: '#9ca3af', icon: '—' },
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PODetailPage() {
  const { role, id: userId } = useUser()
  const params   = useParams()
  const router   = useRouter()
  const poId     = params.id as string

  const [po,      setPo]      = useState<PODetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tab,     setTab]     = useState<'overview' | 'amendments' | 'receipts'>('overview')

  // Approval action state
  const [decision,  setDecision]  = useState<'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'>('APPROVED')
  const [comments,  setComments]  = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  // Submit state
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState<string | null>(null)

  const fetchPO = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/purchase-orders/${poId}`)
      const json = await res.json() as { purchaseOrder: PODetail; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      setPo(json.purchaseOrder)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoading(false) }
  }, [poId])

  useEffect(() => { void fetchPO() }, [fetchPO])

  if (!role || !ALLOWED_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error}</div>
  if (!po)     return null

  const statusStyle = STATUS_STYLES[po.status] ?? STATUS_STYLES.DRAFT

  // Is this user the current pending approver?
  const myPendingApproval = APPROVER_ROLES.has(role)
    ? po.approvals.find(a => a.approver?.id === userId && a.status === 'PENDING')
    : null

  const spentPct = po.totalAmount > 0 ? Math.min(100, (po.amountSpent / po.totalAmount) * 100) : 0

  async function submitForApproval() {
    setSubmitting(true); setSubmitError(null)
    try {
      const res  = await apiClient(`/api/purchase-orders/${poId}/submit`, { method: 'POST' })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Submit failed')
      await fetchPO()
    } catch (e) { setSubmitError(e instanceof Error ? e.message : 'Submit failed') }
    finally { setSubmitting(false) }
  }

  async function submitApprovalDecision() {
    if (!myPendingApproval) return
    setApproving(true); setApproveError(null)
    try {
      const res  = await apiClient(`/api/purchase-orders/${poId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decision, comments }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Decision failed')
      setComments('')
      await fetchPO()
    } catch (e) { setApproveError(e instanceof Error ? e.message : 'Decision failed') }
    finally { setApproving(false) }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* LEFT: PO details */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">

          {/* Breadcrumb + actions */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button onClick={() => router.push('/dashboard/purchase-orders')}
                className="text-sm" style={{ color: 'var(--muted)' }}>← Purchase Orders</button>
              <span style={{ color: 'var(--muted)' }}>/</span>
              <span className="text-sm font-medium font-mono" style={{ color: 'var(--ink)' }}>
                {po.poNumber}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2 py-1 rounded-full"
                style={{ background: statusStyle.bg, color: statusStyle.color }}>
                {statusStyle.label}
              </span>
              {po.status === 'DRAFT' && AMEND_ROLES.has(role) && (
                <Link href={`/dashboard/purchase-orders/${poId}/edit`}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                  Edit
                </Link>
              )}
            </div>
          </div>

          {/* PO Header */}
          <div className="mb-6 p-5 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>{po.title}</h1>
            {po.description && (
              <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>{po.description}</p>
            )}
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span style={{ color: 'var(--muted)' }}>Vendor</span><br />
                <strong style={{ color: 'var(--ink)' }}>{po.entity.name}</strong></div>
              <div><span style={{ color: 'var(--muted)' }}>Type</span><br />
                <strong style={{ color: 'var(--ink)' }}>{po.type}</strong></div>
              <div><span style={{ color: 'var(--muted)' }}>Version</span><br />
                <strong style={{ color: 'var(--ink)' }}>v{po.currentVersion}</strong></div>
              {po.spendCategory && (
                <div><span style={{ color: 'var(--muted)' }}>Category</span><br />
                  <strong style={{ color: 'var(--ink)' }}>{po.spendCategory}</strong></div>
              )}
              {po.department && (
                <div><span style={{ color: 'var(--muted)' }}>Department</span><br />
                  <strong style={{ color: 'var(--ink)' }}>{po.department}</strong></div>
              )}
              {po.requestor && (
                <div><span style={{ color: 'var(--muted)' }}>Requested by</span><br />
                  <strong style={{ color: 'var(--ink)' }}>{po.requestor.name ?? po.requestor.email}</strong></div>
              )}
              {po.validFrom && (
                <div><span style={{ color: 'var(--muted)' }}>Valid from</span><br />
                  <strong style={{ color: 'var(--ink)' }}>{new Date(po.validFrom).toLocaleDateString()}</strong></div>
              )}
              {po.validTo && (
                <div><span style={{ color: 'var(--muted)' }}>Valid to</span><br />
                  <strong style={{ color: 'var(--ink)' }}>{new Date(po.validTo).toLocaleDateString()}</strong></div>
              )}
            </div>

            {/* Financials */}
            <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-end justify-between mb-2">
                <div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>Total Value</div>
                  <div className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
                    {fmt(po.totalAmount, po.currency)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>Spent</div>
                  <div className="text-lg font-medium" style={{ color: 'var(--ink)' }}>
                    {fmt(po.amountSpent, po.currency)}
                  </div>
                </div>
              </div>
              {po.amountSpent > 0 && (
                <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${spentPct}%`, background: spentPct >= 90 ? '#dc2626' : '#2563eb' }} />
                </div>
              )}
            </div>
          </div>

          {/* Submit for approval (DRAFT only) */}
          {po.status === 'DRAFT' && AMEND_ROLES.has(role) && (
            <div className="mb-6 p-4 rounded-xl border" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
              <p className="text-sm mb-3" style={{ color: '#92400e' }}>
                This PO is a draft. Submit for approval when ready.
              </p>
              {submitError && (
                <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{submitError}</p>
              )}
              <button onClick={submitForApproval} disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                {submitting ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b mb-6" style={{ borderColor: 'var(--border)' }}>
            {(['overview', 'amendments', 'receipts'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors"
                style={{
                  borderColor: tab === t ? '#2563eb' : 'transparent',
                  color:       tab === t ? '#2563eb' : 'var(--muted)',
                }}>
                {t === 'receipts' ? 'Goods Receipts' : t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'amendments' && po.amendments.length > 0 && (
                  <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                    style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                    {po.amendments.length}
                  </span>
                )}
                {t === 'receipts' && po.goodsReceipts.length > 0 && (
                  <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                    style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                    {po.goodsReceipts.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Overview tab: line items */}
          {tab === 'overview' && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                    {['#', 'Description', 'Qty', 'Unit Price', 'Tax', 'Total'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium"
                        style={{ color: 'var(--muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {po.lineItems.map((item, i) => (
                    <tr key={item.id} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-2.5 text-xs font-mono" style={{ color: 'var(--muted)' }}>{item.lineNo}</td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ink)' }}>{item.description}</td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ink)' }}>{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ink)' }}>
                        {fmt(item.unitPrice, item.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--muted)' }}>
                        {Math.round(item.taxRate * 100)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium" style={{ color: 'var(--ink)' }}>
                        {fmt(item.totalPrice, item.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface)' }}>
                    <td colSpan={5} className="px-4 py-2.5 text-xs font-medium text-right"
                      style={{ color: 'var(--muted)' }}>Total</td>
                    <td className="px-4 py-2.5 font-semibold text-right" style={{ color: 'var(--ink)' }}>
                      {fmt(po.totalAmount, po.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Amendments tab */}
          {tab === 'amendments' && (
            <div className="space-y-3">
              {po.amendments.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--muted)' }}>No amendments on record.</p>
              ) : po.amendments.map(am => (
                <div key={am.id} className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-xs font-mono font-medium" style={{ color: 'var(--muted)' }}>
                        Amendment v{am.version}
                      </span>
                      {am.actor && (
                        <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                          by {am.actor.name ?? am.actor.email}
                        </span>
                      )}
                    </div>
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {new Date(am.amendedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm mb-2" style={{ color: 'var(--ink)' }}>{am.reason}</p>
                  <div className="flex flex-wrap gap-1">
                    {am.changedFields.map(f => (
                      <span key={f} className="text-xs px-2 py-0.5 rounded"
                        style={{ background: '#eff6ff', color: '#2563eb' }}>
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Goods Receipts tab */}
          {tab === 'receipts' && (
            <div className="space-y-3">
              {po.goodsReceipts.length === 0 ? (
                <div>
                  <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>No goods receipts recorded.</p>
                  {GR_ROLES.has(role) && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
                    <button
                      disabled
                      title="Coming soon"
                      className="text-sm px-4 py-2 rounded-lg border font-medium cursor-not-allowed opacity-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                      + Record Receipt
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {GR_ROLES.has(role) && po.status === 'PARTIALLY_RECEIVED' && (
                    <button
                      disabled
                      title="Coming soon"
                      className="inline-block text-sm px-4 py-2 mb-3 rounded-lg border font-medium cursor-not-allowed opacity-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                      + Record Another Receipt
                    </button>
                  )}
                  {po.goodsReceipts.map(gr => {
                    const grStyle = gr.status === 'FULL' ? { bg: '#f0fdf4', color: '#16a34a' }
                                  : gr.status === 'PARTIAL' ? { bg: '#eff6ff', color: '#2563eb' }
                                  : { bg: '#fef2f2', color: '#dc2626' }
                    return (
                      <div key={gr.id} className="p-4 rounded-xl border"
                        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: grStyle.bg, color: grStyle.color }}>
                            {gr.status}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>
                            {new Date(gr.receivedAt).toLocaleDateString()}
                          </span>
                        </div>
                        {gr.notes && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{gr.notes}</p>}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Approval timeline + context + action */}
      <div className="w-80 flex-shrink-0 border-l overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
        <div className="p-5 space-y-6">

          {/* Approval timeline */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Approval Steps
            </h2>
            {po.approvals.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>No approval steps assigned.</p>
            ) : (
              <div className="space-y-3">
                {po.approvals.map(a => {
                  const s = APPROVAL_STYLES[a.status] ?? APPROVAL_STYLES.PENDING
                  return (
                    <div key={a.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: `${s.color}18`, color: s.color }}>
                          {s.icon}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 pb-3">
                        <div className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
                          Step {a.step} — {a.approver?.name ?? a.approver?.email ?? 'Unassigned'}
                        </div>
                        <div className="text-xs" style={{ color: s.color }}>{a.status}</div>
                        {a.decidedAt && (
                          <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                            {new Date(a.decidedAt).toLocaleDateString()}
                          </div>
                        )}
                        {a.comments && (
                          <div className="text-xs mt-1 italic" style={{ color: 'var(--muted)' }}>
                            &quot;{a.comments}&quot;
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Vendor context */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Vendor Context
            </h2>

            {/* Spend limit */}
            {po.vendorContext.approvedSpendLimit != null && (
              <div className="mb-3 p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>Approved spend limit</div>
                <div className="text-sm font-medium mt-0.5" style={{ color: 'var(--ink)' }}>
                  {fmt(po.vendorContext.approvedSpendLimit, po.currency)}
                </div>
                {po.totalAmount > po.vendorContext.approvedSpendLimit && (
                  <div className="text-xs mt-1" style={{ color: '#dc2626' }}>
                    ⚠ This PO exceeds the approved spend limit
                  </div>
                )}
              </div>
            )}

            {/* Open POs */}
            <div className="mb-3 p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Other open POs</div>
              <div className="text-sm font-medium mt-0.5" style={{ color: 'var(--ink)' }}>
                {po.vendorContext.openPOCount}
              </div>
            </div>

            {/* Spend history chart */}
            {po.vendorContext.spendHistory.length > 1 && (
              <div className="mb-3 p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                  Monthly spend — {po.entity.name}
                </div>
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={po.vendorContext.spendHistory.slice().reverse().map(s => ({
                    period: s.period, avg: s.avgAmount, total: s.totalAmount,
                  }))}>
                    <XAxis dataKey="period" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} width={40} />
                    <Tooltip formatter={(v: number) => fmt(v, po.currency)} />
                    <Line type="monotone" dataKey="avg" stroke="#2563eb" dot={false} strokeWidth={1.5} name="Avg invoice" />
                    <Line type="monotone" dataKey="total" stroke="#94a3b8" dot={false} strokeWidth={1} strokeDasharray="3 3" name="Total" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Recent invoices */}
            {po.vendorContext.recentInvoices.length > 0 && (
              <div className="p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>Recent invoices</div>
                <div className="space-y-1">
                  {po.vendorContext.recentInvoices.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between text-xs">
                      <span style={{ color: 'var(--muted)' }}>
                        {inv.invoiceNo} · {new Date(inv.invoiceDate).toLocaleDateString()}
                      </span>
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>
                        {fmt(inv.amount, inv.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Approver action panel */}
          {myPendingApproval && (
            <section className="p-4 rounded-xl border-2" style={{ borderColor: '#2563eb22', background: '#eff6ff' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: '#1e40af' }}>Your Decision</h2>

              <div className="flex gap-2 mb-3">
                {(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const).map(d => (
                  <button key={d} onClick={() => setDecision(d)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                    style={{
                      background: decision === d
                        ? d === 'APPROVED' ? '#16a34a' : d === 'REJECTED' ? '#dc2626' : '#d97706'
                        : 'var(--bg)',
                      color: decision === d ? '#fff' : 'var(--muted)',
                      borderColor: decision === d
                        ? d === 'APPROVED' ? '#16a34a' : d === 'REJECTED' ? '#dc2626' : '#d97706'
                        : 'var(--border)',
                    }}>
                    {d === 'APPROVED' ? 'Approve' : d === 'REJECTED' ? 'Reject' : 'Request Changes'}
                  </button>
                ))}
              </div>

              <textarea
                value={comments}
                onChange={e => setComments(e.target.value)}
                rows={3}
                placeholder={decision === 'APPROVED' ? 'Notes (optional)' : 'Notes (required)'}
                className="w-full text-sm px-3 py-2 rounded-lg border resize-none mb-3"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
              />

              {approveError && (
                <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{approveError}</p>
              )}

              <button onClick={submitApprovalDecision} disabled={approving}
                className="w-full py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}>
                {approving ? 'Saving…' : 'Submit Decision'}
              </button>
            </section>
          )}

        </div>
      </div>
    </div>
  )
}
