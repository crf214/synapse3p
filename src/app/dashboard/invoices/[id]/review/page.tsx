'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const ALLOWED_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const ROUTING_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const APPROVER_ROLES = ['FINANCE_MANAGER', 'CONTROLLER', 'CFO']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedField {
  fieldName:       string
  rawValue:        string | null
  normalizedValue: string | null
  confidence:      number
  needsReview:     boolean
  reviewedValue:   string | null
}

interface RiskSignal {
  signalType: string
  triggered:  boolean
  detail:     string | null
  value:      number | null
}

interface Approver { id: string; name: string | null; email: string; role: string }

interface InvoiceDetail {
  id:           string
  invoiceNo:    string
  amount:       number
  currency:     string
  invoiceDate:  string
  dueDate:      string | null
  status:       string
  source:       string
  isRecurring:  boolean
  contractId:   string | null
  pdfSignedUrl: string | null
  entity:       { id: string; name: string; slug: string }
  contract:     { contractNo: string; status: string; endDate: string | null; type: string } | null
  extractedFields: ExtractedField[]
  riskEvaluations: Array<{
    tier:        string | null
    overallScore: number
    signals:     RiskSignal[]
  }>
  decision:     { decision: string } | null
  approvals:    Array<{ status: string; assignee: { name: string | null; email: string } }>
  vendorContext: {
    spendHistory: Array<{ period: string; totalAmount: number; avgAmount: number; invoiceCount: number }>
    recentInvoices: Array<{ id: string; invoiceNo: string; amount: number; currency: string; invoiceDate: string; status: string }>
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function confColor(c: number): string {
  if (c >= 0.85) return '#16a34a'
  if (c >= 0.60) return '#d97706'
  return '#dc2626'
}

function ConfBadge({ confidence }: { confidence: number }) {
  return (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded"
      style={{ background: `${confColor(confidence)}18`, color: confColor(confidence) }}>
      {Math.round(confidence * 100)}%
    </span>
  )
}

const FIELD_LABELS: Record<string, string> = {
  vendorName: 'Vendor Name', invoiceNo: 'Invoice #', invoiceDate: 'Invoice Date',
  dueDate: 'Due Date', subtotal: 'Subtotal', taxAmount: 'Tax', totalAmount: 'Total Amount',
  currency: 'Currency', poReference: 'PO Reference', lineItems: 'Line Items',
}

const SIGNAL_LABELS: Record<string, string> = {
  NEW_VENDOR:             'New vendor',
  AMOUNT_VARIANCE:        'Amount variance',
  NO_CONTRACT_MATCH:      'No contract match',
  CONTRACT_EXPIRED:       'Contract expired',
  CONTRACT_EXPIRING_SOON: 'Contract expiring soon',
  DUPLICATE_FLAG:         'Duplicate flag (overridden)',
  MISSING_FIELDS:         'Missing / low-confidence fields',
  UNCONTRACTED_SPEND:     'Uncontracted spend',
  AMOUNT_OVER_THRESHOLD:  'Over approval threshold',
  FREQUENCY_ANOMALY:      'Frequency anomaly',
  SANCTION_FLAG:          'Sanctions flag',
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InvoiceReviewPage() {
  const { role } = useUser()
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string

  const [invoice,    setInvoice]    = useState<InvoiceDetail | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [approvers,  setApprovers]  = useState<Approver[]>([])
  const [corrections, setCorrections] = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)
  const [selectedApprover, setSelectedApprover] = useState('')
  const [routeNotes,       setRouteNotes]       = useState('')
  const [routing,          setRouting]          = useState(false)
  const [routeError,       setRouteError]       = useState<string | null>(null)

  const fetchInvoice = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/invoices/${invoiceId}`)
      const json = await res.json() as { invoice: InvoiceDetail; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      setInvoice(json.invoice)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoading(false) }
  }, [invoiceId])

  useEffect(() => { void fetchInvoice() }, [fetchInvoice])

  useEffect(() => {
    if (!role || !ROUTING_ROLES.has(role)) return
    fetch(`/api/users?roles=${APPROVER_ROLES.join(',')}`)
      .then(r => r.json())
      .then((j: { users: Approver[] }) => setApprovers(j.users))
      .catch(() => {})
  }, [role])

  if (!role || !ALLOWED_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  async function saveCorrections() {
    if (!invoice) return
    setSaving(true)
    try {
      const fieldCorrections = Object.entries(corrections).map(([fieldName, reviewedValue]) => ({ fieldName, reviewedValue }))
      await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldCorrections }),
      })
      await fetchInvoice()
      setCorrections({})
    } finally { setSaving(false) }
  }

  async function routeToApprover() {
    if (!selectedApprover) return
    setRouting(true); setRouteError(null)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: selectedApprover, notes: routeNotes }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Route failed')
      router.push('/dashboard/invoices')
    } catch (e) { setRouteError(e instanceof Error ? e.message : 'Route failed') }
    finally { setRouting(false) }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading invoice…</div>
  if (error)   return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error}</div>
  if (!invoice) return null

  const latestRisk = invoice.riskEvaluations[0] ?? null
  const triggeredSignals = latestRisk?.signals.filter(s => s.triggered) ?? []

  const tierColor = latestRisk?.tier === 'HIGH' ? '#dc2626' : latestRisk?.tier === 'MEDIUM' ? '#d97706' : '#16a34a'
  const tierBg    = latestRisk?.tier === 'HIGH' ? '#fef2f2' : latestRisk?.tier === 'MEDIUM' ? '#fffbeb' : '#f0fdf4'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* LEFT: PDF viewer */}
      <div className="w-1/2 flex-shrink-0 border-r overflow-hidden flex flex-col"
        style={{ borderColor: 'var(--border)' }}>
        <div className="px-6 py-4 border-b flex items-center gap-3"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <button onClick={() => router.push('/dashboard/invoices')}
            className="text-sm" style={{ color: 'var(--muted)' }}>
            ← Invoices
          </button>
          <span style={{ color: 'var(--muted)' }}>/</span>
          <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            Review: {invoice.invoiceNo}
          </span>
        </div>

        {invoice.pdfSignedUrl ? (
          <iframe src={invoice.pdfSignedUrl} className="flex-1 w-full" title="Invoice PDF" />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm"
            style={{ color: 'var(--muted)' }}>
            No PDF available for this invoice.
          </div>
        )}
      </div>

      {/* RIGHT: structured panel */}
      <div className="w-1/2 overflow-y-auto">
        <div className="p-6 space-y-6">

          {/* --- A: Extracted Fields --- */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                Extracted Fields
              </h2>
              {Object.keys(corrections).length > 0 && (
                <button onClick={saveCorrections} disabled={saving}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                  style={{ background: '#2563eb', color: '#fff' }}>
                  {saving ? 'Saving…' : `Save ${Object.keys(corrections).length} correction${Object.keys(corrections).length !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {invoice.extractedFields.map(f => {
                const corrected = corrections[f.fieldName]
                const display   = corrected ?? f.reviewedValue ?? f.normalizedValue ?? ''
                const isChanged = corrected !== undefined
                const needsFlag = f.needsReview && !f.reviewedValue

                return (
                  <div key={f.fieldName}
                    className="flex items-start gap-3 px-3 py-2 rounded-lg"
                    style={{
                      background: needsFlag ? '#fffbeb' : 'var(--surface)',
                      border: `1px solid ${needsFlag ? '#fde68a' : 'var(--border)'}`,
                    }}>
                    <div className="w-32 flex-shrink-0 text-xs pt-1" style={{ color: 'var(--muted)' }}>
                      {FIELD_LABELS[f.fieldName] ?? f.fieldName}
                    </div>
                    <div className="flex-1 min-w-0">
                      <input
                        value={display}
                        onChange={e => setCorrections(prev => ({ ...prev, [f.fieldName]: e.target.value }))}
                        className="w-full text-sm bg-transparent outline-none"
                        style={{ color: isChanged ? '#2563eb' : 'var(--ink)' }}
                      />
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <ConfBadge confidence={f.confidence} />
                      {needsFlag && (
                        <span className="text-xs" style={{ color: '#d97706' }}>⚠ Review</span>
                      )}
                    </div>
                  </div>
                )
              })}
              {invoice.extractedFields.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  AI extraction pending or not yet run.
                </p>
              )}
            </div>
          </section>

          {/* --- B: Context Panel --- */}
          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--ink)' }}>
              Vendor Context
            </h2>

            {/* Contract match */}
            <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Contract</div>
              {invoice.contract ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {invoice.contract.contractNo} ({invoice.contract.type})
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: invoice.contract.status === 'ACTIVE' ? '#f0fdf4' : '#fef2f2',
                      color: invoice.contract.status === 'ACTIVE' ? '#16a34a' : '#dc2626',
                    }}>
                    {invoice.contract.status}
                  </span>
                  {invoice.contract.endDate && (
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      · expires {new Date(invoice.contract.endDate).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-sm" style={{ color: '#dc2626' }}>No contract matched</span>
              )}
            </div>

            {/* Spend history chart */}
            {invoice.vendorContext.spendHistory.length > 1 && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>
                  Monthly spend — {invoice.entity.name}
                </div>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={invoice.vendorContext.spendHistory.map(s => ({
                    period: s.period,
                    avg:    Number(s.avgAmount),
                    total:  Number(s.totalAmount),
                  }))}>
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={50} />
                    <Tooltip formatter={(v: number) => fmt(v, invoice.currency)} />
                    <Line type="monotone" dataKey="avg"   stroke="#2563eb" dot={false} strokeWidth={1.5} name="Avg invoice" />
                    <Line type="monotone" dataKey="total" stroke="#94a3b8" dot={false} strokeWidth={1}   name="Total spend" strokeDasharray="3 3" />
                  </LineChart>
                </ResponsiveContainer>

                {/* Current invoice vs avg */}
                {invoice.vendorContext.spendHistory.length > 0 && (() => {
                  const last = invoice.vendorContext.spendHistory[invoice.vendorContext.spendHistory.length - 1]
                  const avg  = Number(last.avgAmount)
                  const diff = avg > 0 ? ((invoice.amount - avg) / avg) * 100 : 0
                  return (
                    <div className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      This invoice: {fmt(invoice.amount, invoice.currency)} ·{' '}
                      <span style={{ color: Math.abs(diff) > 10 ? '#dc2626' : '#16a34a' }}>
                        {diff > 0 ? '+' : ''}{diff.toFixed(1)}% vs avg
                      </span>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Recent invoices */}
            {invoice.vendorContext.recentInvoices.length > 0 && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>Last 5 invoices</div>
                <div className="space-y-1">
                  {invoice.vendorContext.recentInvoices.map(ri => (
                    <div key={ri.id} className="flex items-center justify-between text-xs">
                      <span style={{ color: 'var(--muted)' }}>
                        {ri.invoiceNo} · {new Date(ri.invoiceDate).toLocaleDateString()}
                      </span>
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>
                        {fmt(ri.amount, ri.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk breakdown */}
            {latestRisk && (
              <div className="p-3 rounded-lg" style={{ background: tierBg, border: `1px solid ${tierColor}22` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: tierColor }}>
                    Risk: {latestRisk.tier ?? '—'} (score {latestRisk.overallScore.toFixed(1)})
                  </span>
                </div>
                {triggeredSignals.length === 0 ? (
                  <p className="text-xs" style={{ color: '#16a34a' }}>No risk signals triggered.</p>
                ) : (
                  <ul className="space-y-1">
                    {triggeredSignals.map(s => (
                      <li key={s.signalType} className="flex items-start gap-2 text-xs">
                        <span style={{ color: '#dc2626' }}>⚑</span>
                        <span style={{ color: 'var(--ink)' }}>
                          <strong>{SIGNAL_LABELS[s.signalType] ?? s.signalType}</strong>
                          {s.detail && <span style={{ color: 'var(--muted)' }}> — {s.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {/* --- C: Action Panel --- */}
          {ROUTING_ROLES.has(role) && (
            <section className="p-4 rounded-xl"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--ink)' }}>Route for Approval</h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    Assign to approver
                  </label>
                  <select value={selectedApprover}
                    onChange={e => setSelectedApprover(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
                    <option value="">Select approver…</option>
                    {approvers.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name ?? a.email} ({a.role.replace('_', ' ')})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    Notes (optional)
                  </label>
                  <textarea
                    value={routeNotes}
                    onChange={e => setRouteNotes(e.target.value)}
                    rows={2}
                    placeholder="Context for the approver…"
                    className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                  />
                </div>

                {routeError && (
                  <p className="text-xs" style={{ color: '#dc2626' }}>{routeError}</p>
                )}

                <button onClick={routeToApprover}
                  disabled={!selectedApprover || routing}
                  className="w-full py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-opacity"
                  style={{ background: '#2563eb', color: '#fff' }}>
                  {routing ? 'Routing…' : 'Route for Approval'}
                </button>
              </div>
            </section>
          )}

          {/* Existing approvals */}
          {invoice.approvals.length > 0 && (
            <section>
              <h2 className="text-sm font-medium mb-2" style={{ color: 'var(--muted)' }}>Approval History</h2>
              <div className="space-y-2">
                {invoice.approvals.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--ink)' }}>{a.assignee.name ?? a.assignee.email}</span>
                    <span className="px-2 py-0.5 rounded-full"
                      style={{
                        background: a.status === 'APPROVED' ? '#f0fdf4' : a.status === 'REJECTED' ? '#fef2f2' : '#fffbeb',
                        color:      a.status === 'APPROVED' ? '#16a34a' : a.status === 'REJECTED' ? '#dc2626' : '#d97706',
                      }}>
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  )
}
