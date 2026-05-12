'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { apiClient } from '@/lib/api-client'
import { WorkflowPanel } from '@/components/shared/WorkflowPanel'
import type { WorkflowState, WorkflowHistoryEntry } from '@/components/shared/WorkflowPanel'

const ALLOWED_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const ROUTING_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const APPROVER_ROLES = ['FINANCE_MANAGER', 'CONTROLLER', 'CFO']
const APPROVE_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const OVERRIDE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

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

interface PoMatchResult {
  passed:         boolean
  matchType:      'THREE_WAY' | 'NONE'
  grCount:        number
  failureReason?: string
  po?:            { id: string; poNumber: string; totalAmount: number; amountSpent: number; remainingBudget: number }
  checks: {
    poExists:           boolean
    poApproved:         boolean
    entityMatch:        boolean
    amountWithinBudget: boolean
    grExists:           boolean
    quantityCovered:    boolean
  }
}

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
  poId:         string | null
  matchType:    string | null
  pdfSignedUrl: string | null
  entity:       { id: string; name: string; slug: string; status: string; riskBand: string | null; riskBandOverride: string | null }
  contract:     { contractNo: string; status: string; endDate: string | null; type: string } | null
  extractedFields: ExtractedField[]
  riskEvaluations: Array<{
    tier:        string | null
    overallScore: number
    signals:     RiskSignal[]
  }>
  decision:     { decision: string } | null
  approvals:    Array<{ status: string; assignee: { id: string; name: string | null; email: string } }>
  disputes: Array<{
    id: string; title: string; description: string | null; occurredAt: string; disputeType: string; status: string
  }>
  duplicateFlags: Array<{
    id:          string
    status:      string
    detectedAt:  string
    matchedOnInvoiceNo:    boolean
    matchedOnVendorAmount: boolean
    matchedOnPdfHash:      boolean
    matchedOnEmailMsgId:   boolean
    duplicateOf: { id: string; invoiceNo: string; amount: number; currency: string; invoiceDate: string } | null
  }>
  vendorContext: {
    spendHistory: Array<{ period: string; totalAmount: number; avgAmount: number; invoiceCount: number }>
    recentInvoices: Array<{ id: string; invoiceNo: string; amount: number; currency: string; invoiceDate: string; status: string }>
  }
}

interface LineItem {
  description?: string
  qty?:         number | string
  unitPrice?:   number | string
  total?:       number | string
  [key: string]: unknown
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

const RISK_BAND_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  LOW:      { color: '#16a34a', bg: '#f0fdf4', label: 'LOW' },
  MEDIUM:   { color: '#d97706', bg: '#fffbeb', label: 'MEDIUM' },
  HIGH:     { color: '#ea580c', bg: '#fff7ed', label: 'HIGH' },
  CRITICAL: { color: '#dc2626', bg: '#fef2f2', label: 'CRITICAL' },
}

function EntityRiskBadge({ entity }: { entity: InvoiceDetail['entity'] }) {
  if (entity.status === 'PROVISIONAL') {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
        style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
        Provisional entity
      </span>
    )
  }
  if (entity.riskBand) {
    const style = RISK_BAND_STYLE[entity.riskBand] ?? { color: '#6b7280', bg: '#f9fafb', label: entity.riskBand }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
        style={{ background: style.bg, color: style.color, border: `1px solid ${style.color}22` }}>
        {style.label}
        {entity.riskBandOverride && (
          <span className="text-xs opacity-70" title={`Override: ${entity.riskBandOverride}`}>⚙</span>
        )}
      </span>
    )
  }
  return null
}

function tryParseLineItems(raw: string | null): LineItem[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as LineItem[]
  } catch { /* fall through */ }
  return null
}

function LineItemsTable({ items }: { items: LineItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th className="text-left pb-1 pr-3 font-medium" style={{ color: 'var(--muted)' }}>Description</th>
            <th className="text-right pb-1 pr-3 font-medium" style={{ color: 'var(--muted)' }}>Qty</th>
            <th className="text-right pb-1 pr-3 font-medium" style={{ color: 'var(--muted)' }}>Unit Price</th>
            <th className="text-right pb-1 font-medium" style={{ color: 'var(--muted)' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <td className="py-1 pr-3" style={{ color: 'var(--ink)' }}>{String(item.description ?? '—')}</td>
              <td className="py-1 pr-3 text-right" style={{ color: 'var(--ink)' }}>{String(item.qty ?? '—')}</td>
              <td className="py-1 pr-3 text-right" style={{ color: 'var(--ink)' }}>{String(item.unitPrice ?? '—')}</td>
              <td className="py-1 text-right" style={{ color: 'var(--ink)' }}>{String(item.total ?? '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// Fetch a remote PDF and return a local blob URL so X-Frame-Options is bypassed.
function usePdfBlobUrl(signedUrl: string | null): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!signedUrl) return
    let objectUrl: string
    fetch(signedUrl)
      .then(r => r.blob())
      .then(blob => {
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      })
      .catch(() => {/* leave null — fallback message shown */})
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [signedUrl])
  return blobUrl
}

export default function InvoiceReviewPage() {
  const user   = useUser()
  const { role } = user
  const params = useParams()
  const router = useRouter()
  const invoiceId = params.id as string
  const qc = useQueryClient()

  const [corrections, setCorrections] = useState<Record<string, string>>({})
  const [saving,     setSaving]     = useState(false)

  // Routing state (AP_CLERK → assigns to approver)
  const [selectedApprover, setSelectedApprover] = useState('')
  const [routeNotes,       setRouteNotes]       = useState('')
  const [routing,          setRouting]          = useState(false)
  const [routeError,       setRouteError]       = useState<string | null>(null)

  // Decision state (approver → approve / reject / escalate)
  const [decision,          setDecision]          = useState<'APPROVED' | 'REJECTED' | 'ESCALATED' | null>(null)
  const [decisionNotes,     setDecisionNotes]     = useState('')
  const [escalateTo,        setEscalateTo]        = useState('')
  const [submittingDecision, setSubmittingDecision] = useState(false)
  const [decisionError,     setDecisionError]     = useState<string | null>(null)

  // Override state (OVERRIDE_ROLES → release duplicate quarantine)
  const [overrideJustification, setOverrideJustification] = useState('')
  const [submittingOverride,    setSubmittingOverride]    = useState(false)
  const [overrideError,         setOverrideError]         = useState<string | null>(null)

  // Three-way match override state (CONTROLLER/CFO → bypass failed match)
  const [matchOverrideJustification, setMatchOverrideJustification] = useState('')

  const invoiceQueryKey = queryKeys.invoices.detail(invoiceId)

  const { data: invoice, isLoading: loading, isError, error } = useQuery({
    queryKey: invoiceQueryKey,
    queryFn:  async () => {
      const res  = await fetch(`/api/invoices/${invoiceId}`)
      const json = await res.json() as { invoice: InvoiceDetail; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      return json.invoice
    },
  })

  const { data: approversData } = useQuery({
    queryKey: queryKeys.users.approvers(APPROVER_ROLES),
    enabled:  !!role && ROUTING_ROLES.has(role),
    queryFn:  async () => {
      const res = await fetch(`/api/users?roles=${APPROVER_ROLES.join(',')}`)
      if (!res.ok) return { users: [] as Approver[] }
      return res.json() as Promise<{ users: Approver[] }>
    },
  })
  const approvers = approversData?.users ?? []

  const { data: disputesData } = useQuery({
    queryKey: queryKeys.invoices.disputes(invoiceId),
    queryFn:  async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/disputes`)
      if (!res.ok) return { disputes: [] as InvoiceDetail['disputes'] }
      return res.json() as Promise<{ disputes: InvoiceDetail['disputes'] }>
    },
  })
  const disputes = disputesData?.disputes ?? []

  const { data: workflowData } = useQuery({
    queryKey: queryKeys.invoices.workflow(invoiceId),
    queryFn:  async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/workflow`)
      if (!res.ok) return { workflow: null }
      return res.json() as Promise<{ workflow: WorkflowState | null; history?: WorkflowHistoryEntry[] }>
    },
  })

  const { data: poMatchData } = useQuery({
    queryKey: ['invoices', invoiceId, 'po-match'],
    enabled:  !!invoice?.poId,
    queryFn:  async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/po-match`)
      if (!res.ok) return { match: null, currentMatchType: null }
      return res.json() as Promise<{ match: PoMatchResult | null; currentMatchType: string | null }>
    },
  })

  // PDF blob URL — must be called before any early returns (Rules of Hooks)
  const pdfBlobUrl = usePdfBlobUrl(invoice?.pdfSignedUrl ?? null)

  if (!role || !ALLOWED_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  async function saveCorrections() {
    if (!invoice) return
    setSaving(true)
    try {
      const fieldCorrections = Object.entries(corrections).map(([fieldName, reviewedValue]) => ({ fieldName, reviewedValue }))
      await apiClient(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldCorrections }),
      })
      void qc.invalidateQueries({ queryKey: invoiceQueryKey })
      setCorrections({})
    } finally { setSaving(false) }
  }

  async function routeToApprover() {
    if (!selectedApprover) return
    setRouting(true); setRouteError(null)
    try {
      const res = await apiClient(`/api/invoices/${invoiceId}/approve`, {
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

  async function submitDecision() {
    if (!decision) return
    if (decision === 'ESCALATED' && !escalateTo) {
      setDecisionError('Please select who to escalate to.')
      return
    }
    setSubmittingDecision(true); setDecisionError(null)
    try {
      const res = await apiClient(`/api/invoices/${invoiceId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          notes:                      decisionNotes || undefined,
          escalateTo:                 decision === 'ESCALATED' ? escalateTo : undefined,
          matchOverrideJustification: matchOverrideJustification.trim().length >= 10 ? matchOverrideJustification.trim() : undefined,
        }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Decision failed')
      router.push('/dashboard/approvals')
    } catch (e) { setDecisionError(e instanceof Error ? e.message : 'Failed') }
    finally { setSubmittingDecision(false) }
  }

  async function submitOverride(flagId: string) {
    if (overrideJustification.trim().length < 10) {
      setOverrideError('Justification must be at least 10 characters.')
      return
    }
    setSubmittingOverride(true); setOverrideError(null)
    try {
      const res = await apiClient(`/api/invoices/${invoiceId}/override-duplicate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ flagId, justification: overrideJustification.trim() }),
      })
      const json = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Override failed')
      void qc.invalidateQueries({ queryKey: invoiceQueryKey })
      setOverrideJustification('')
    } catch (e) { setOverrideError(e instanceof Error ? e.message : 'Override failed') }
    finally { setSubmittingOverride(false) }
  }

  if (loading)  return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading invoice…</div>
  if (isError)  return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error instanceof Error ? error.message : 'Unknown error'}</div>
  if (!invoice) return null

  const latestRisk = invoice.riskEvaluations[0] ?? null
  const triggeredSignals = latestRisk?.signals.filter(s => s.triggered) ?? []

  const tierColor = latestRisk?.tier === 'HIGH' ? '#dc2626' : latestRisk?.tier === 'MEDIUM' ? '#d97706' : '#16a34a'
  const tierBg    = latestRisk?.tier === 'HIGH' ? '#fef2f2' : latestRisk?.tier === 'MEDIUM' ? '#fffbeb' : '#f0fdf4'

  // Is the current user the assigned approver with a pending decision?
  const myPendingApproval = APPROVE_ROLES.has(role)
    ? invoice.approvals.find(a => a.status === 'PENDING' && a.assignee.id === user.id)
    : null

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
          <span className="text-sm" style={{ color: 'var(--muted)' }}>·</span>
          <span className="text-sm" style={{ color: 'var(--ink)' }}>{invoice.entity.name}</span>
          <EntityRiskBadge entity={invoice.entity} />
        </div>

        {pdfBlobUrl ? (
          <iframe src={pdfBlobUrl} className="flex-1 w-full" title="Invoice PDF" />
        ) : invoice.pdfSignedUrl ? (
          <div className="flex-1 flex items-center justify-center text-sm"
            style={{ color: 'var(--muted)' }}>
            Loading PDF…
          </div>
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

          {/* --- DUPLICATE QUARANTINE PANEL --- */}
          {invoice.status === 'DUPLICATE' && (invoice.duplicateFlags ?? []).length > 0 && (
            <section className="p-4 rounded-xl"
              style={{ background: '#fef2f2', border: '1px solid #dc262633' }}>
              <h2 className="text-base font-semibold mb-1" style={{ color: '#991b1b' }}>
                Quarantined — Suspected Duplicate
              </h2>
              <p className="text-xs mb-4" style={{ color: '#dc2626' }}>
                This invoice was flagged by the pipeline and held. Review the match details below before deciding to override.
              </p>

              {(invoice.duplicateFlags ?? []).filter(f => f.status === 'QUARANTINED').map(flag => {
                const matchSignals: string[] = []
                if (flag.matchedOnPdfHash)      matchSignals.push('Identical PDF')
                if (flag.matchedOnEmailMsgId)   matchSignals.push('Same email')
                if (flag.matchedOnInvoiceNo)    matchSignals.push('Invoice #')
                if (flag.matchedOnVendorAmount) matchSignals.push('Vendor + amount')

                return (
                  <div key={flag.id} className="mb-4 space-y-3">
                    {/* Match signals */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium" style={{ color: '#991b1b' }}>Matched on:</span>
                      {matchSignals.map(s => (
                        <span key={s} className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262222' }}>
                          {s}
                        </span>
                      ))}
                    </div>

                    {/* Original invoice */}
                    {flag.duplicateOf && (
                      <div className="p-2 rounded-lg text-xs"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--muted)' }}>Original: </span>
                        <a href={`/dashboard/invoices/${flag.duplicateOf.id}/review`}
                          className="font-medium underline" style={{ color: '#2563eb' }}>
                          {flag.duplicateOf.invoiceNo}
                        </a>
                        <span style={{ color: 'var(--muted)' }}>
                          {' · '}{new Intl.NumberFormat('en-US', { style: 'currency', currency: flag.duplicateOf.currency }).format(flag.duplicateOf.amount)}
                          {' · '}{new Date(flag.duplicateOf.invoiceDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}

                    {/* Override panel for eligible roles */}
                    {OVERRIDE_ROLES.has(role) && (
                      <div className="space-y-2">
                        <div className="p-2 rounded-lg text-xs"
                          style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                          <strong style={{ color: '#92400e' }}>Financial control: </strong>
                          <span style={{ color: '#78350f' }}>Override is permanently recorded in the audit trail.</span>
                        </div>
                        <textarea
                          value={overrideJustification}
                          onChange={e => setOverrideJustification(e.target.value)}
                          rows={3}
                          placeholder="Justification for override (min 10 characters)…"
                          className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
                          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: overrideJustification.length < 10 ? '#dc2626' : 'var(--muted)' }}>
                            {overrideJustification.length} / 10 min
                          </span>
                          <button
                            onClick={() => submitOverride(flag.id)}
                            disabled={submittingOverride || overrideJustification.trim().length < 10}
                            className="text-xs px-4 py-1.5 rounded-lg font-medium disabled:opacity-40"
                            style={{ background: '#d97706', color: '#fff' }}>
                            {submittingOverride ? 'Overriding…' : 'Override & Release'}
                          </button>
                        </div>
                        {overrideError && (
                          <p className="text-xs" style={{ color: '#dc2626' }}>{overrideError}</p>
                        )}
                      </div>
                    )}

                    {!OVERRIDE_ROLES.has(role) && (
                      <p className="text-xs" style={{ color: '#dc2626' }}>
                        Only Finance Manager, Controller, or CFO can override this flag.
                      </p>
                    )}
                  </div>
                )
              })}
            </section>
          )}

          {/* --- DECISION PANEL (shown only to the assigned approver) --- */}
          {myPendingApproval && (
            <section className="p-4 rounded-xl"
              style={{ background: '#eff6ff', border: '1px solid #2563eb33' }}>
              <h2 className="text-base font-semibold mb-1" style={{ color: '#1e40af' }}>
                Your Approval Required
              </h2>
              <p className="text-xs mb-4" style={{ color: '#3b82f6' }}>
                This invoice has been routed to you for a decision.
              </p>

              {/* Decision buttons */}
              <div className="flex gap-2 mb-3">
                {(['APPROVED', 'REJECTED', 'ESCALATED'] as const).map(d => {
                  const colors = {
                    APPROVED:  { active: '#16a34a', bg: '#f0fdf4', border: '#16a34a' },
                    REJECTED:  { active: '#dc2626', bg: '#fef2f2', border: '#dc2626' },
                    ESCALATED: { active: '#d97706', bg: '#fffbeb', border: '#d97706' },
                  }[d]
                  const isSelected = decision === d
                  return (
                    <button key={d} onClick={() => setDecision(isSelected ? null : d)}
                      className="flex-1 py-2 rounded-lg text-xs font-medium border transition-all"
                      style={{
                        background:   isSelected ? colors.bg    : 'var(--bg)',
                        borderColor:  isSelected ? colors.border : 'var(--border)',
                        color:        isSelected ? colors.active : 'var(--muted)',
                      }}>
                      {d === 'APPROVED' ? 'Approve' : d === 'REJECTED' ? 'Reject' : 'Escalate'}
                    </button>
                  )
                })}
              </div>

              {/* Escalation target picker */}
              {decision === 'ESCALATED' && (
                <div className="mb-3">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    Escalate to
                  </label>
                  <select value={escalateTo} onChange={e => setEscalateTo(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
                    <option value="">Select approver…</option>
                    {approvers.filter(a => a.id !== user.id).map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name ?? a.email} ({a.role.replace('_', ' ')})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Notes */}
              <div className="mb-3">
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>
                  Notes (optional)
                </label>
                <textarea
                  value={decisionNotes}
                  onChange={e => setDecisionNotes(e.target.value)}
                  rows={2}
                  placeholder="Reason for decision…"
                  className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                />
              </div>

              {decisionError && (
                <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{decisionError}</p>
              )}

              <button onClick={submitDecision}
                disabled={!decision || submittingDecision}
                className="w-full py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-opacity"
                style={{
                  background: decision === 'APPROVED' ? '#16a34a' : decision === 'REJECTED' ? '#dc2626' : decision === 'ESCALATED' ? '#d97706' : '#6b7280',
                  color: '#fff',
                }}>
                {submittingDecision
                  ? 'Submitting…'
                  : decision === 'APPROVED' ? 'Confirm Approval'
                  : decision === 'REJECTED' ? 'Confirm Rejection'
                  : decision === 'ESCALATED' ? 'Confirm Escalation'
                  : 'Select a decision above'}
              </button>
            </section>
          )}

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
                const corrected  = corrections[f.fieldName]
                const display    = corrected ?? f.reviewedValue ?? f.normalizedValue ?? ''
                const isChanged  = corrected !== undefined
                const isVerified = corrected !== undefined || f.reviewedValue !== null
                const needsFlag  = f.needsReview && !isVerified

                const confidenceBadge = isVerified
                  ? <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                      style={{ background: '#f0fdf4', color: '#16a34a' }}>✓ Verified</span>
                  : <ConfBadge confidence={f.confidence} />

                // Line items get a table instead of a text input
                if (f.fieldName === 'lineItems') {
                  const items = tryParseLineItems(display || f.rawValue)
                  return (
                    <div key={f.fieldName}
                      className="px-3 py-2 rounded-lg"
                      style={{
                        background: needsFlag ? '#fffbeb' : 'var(--surface)',
                        border: `1px solid ${needsFlag ? '#fde68a' : 'var(--border)'}`,
                      }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>Line Items</span>
                        <div className="flex items-center gap-2">
                          {confidenceBadge}
                          {needsFlag && <span className="text-xs" style={{ color: '#d97706' }}>⚠ Review</span>}
                        </div>
                      </div>
                      {items ? (
                        <LineItemsTable items={items} />
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>No line items extracted.</span>
                      )}
                    </div>
                  )
                }

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
                      {confidenceBadge}
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

            {/* PO Match */}
            {invoice.poId && (
              <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>PO Match</div>
                {!poMatchData ? (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>Loading…</span>
                ) : !poMatchData.match ? (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>No PO linked</span>
                ) : (
                  <div className="space-y-2">
                    {/* Overall result */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: poMatchData.match.passed ? '#f0fdf4' : '#fef2f2',
                          color:      poMatchData.match.passed ? '#16a34a' : '#dc2626',
                          border:     `1px solid ${poMatchData.match.passed ? '#bbf7d0' : '#fecaca'}`,
                        }}>
                        {poMatchData.match.passed ? '✓ Three-way match passed' : '✗ Match failed'}
                      </span>
                      {poMatchData.match.po && (
                        <span className="text-xs font-mono" style={{ color: 'var(--muted)' }}>
                          {poMatchData.match.po.poNumber}
                        </span>
                      )}
                    </div>

                    {/* Failure reason */}
                    {!poMatchData.match.passed && poMatchData.match.failureReason && (
                      <p className="text-xs" style={{ color: '#dc2626' }}>{poMatchData.match.failureReason}</p>
                    )}

                    {/* Check grid */}
                    <div className="grid grid-cols-2 gap-1">
                      {(Object.entries(poMatchData.match.checks) as [string, boolean][]).map(([key, ok]) => {
                        const labels: Record<string, string> = {
                          poExists:           'PO exists',
                          poApproved:         'PO approved',
                          entityMatch:        'Entity match',
                          amountWithinBudget: 'Within budget',
                          grExists:           'Goods receipt',
                          quantityCovered:    'Qty covered',
                        }
                        return (
                          <div key={key} className="flex items-center gap-1.5 text-xs">
                            <span style={{ color: ok ? '#16a34a' : '#dc2626' }}>{ok ? '✓' : '✗'}</span>
                            <span style={{ color: ok ? 'var(--ink)' : '#dc2626' }}>{labels[key] ?? key}</span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Budget summary */}
                    {poMatchData.match.po && (
                      <div className="text-xs" style={{ color: 'var(--muted)' }}>
                        Budget: {fmt(poMatchData.match.po.totalAmount, invoice.currency)} total ·{' '}
                        {fmt(poMatchData.match.po.amountSpent, invoice.currency)} spent ·{' '}
                        <span style={{ color: poMatchData.match.po.remainingBudget >= invoice.amount ? '#16a34a' : '#dc2626' }}>
                          {fmt(poMatchData.match.po.remainingBudget, invoice.currency)} remaining
                        </span>
                      </div>
                    )}

                    {/* GR count */}
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {poMatchData.match.grCount} goods receipt{poMatchData.match.grCount !== 1 ? 's' : ''} on file
                    </div>

                    {/* Override section for Controller/CFO when match failed */}
                    {!poMatchData.match.passed && (role === 'CONTROLLER' || role === 'CFO' || role === 'ADMIN') && (
                      <div className="mt-2 space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                        <p className="text-xs font-medium" style={{ color: '#d97706' }}>
                          Override match check
                        </p>
                        <textarea
                          value={matchOverrideJustification}
                          onChange={e => setMatchOverrideJustification(e.target.value)}
                          rows={2}
                          placeholder="Justification for approving despite failed match (min 10 chars)…"
                          className="w-full text-xs px-2.5 py-1.5 rounded-lg border resize-none"
                          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
                        />
                        <p className="text-xs" style={{ color: matchOverrideJustification.length < 10 ? '#dc2626' : '#16a34a' }}>
                          {matchOverrideJustification.length} / 10 min — provide this justification when submitting your decision above
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

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

          {/* --- C: Route for Approval (routing roles only, when not already pending) --- */}
          {ROUTING_ROLES.has(role) && invoice.status !== 'PENDING_REVIEW' && invoice.status !== 'APPROVED' && invoice.status !== 'REJECTED' && (
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

          {/* Vendor disputes */}
          {disputes.length > 0 && (
            <section>
              <h2 className="text-sm font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                Vendor Disputes
                {disputes.filter(d => d.status === 'OPEN').length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
                    {disputes.filter(d => d.status === 'OPEN').length} open
                  </span>
                )}
              </h2>
              <div className="space-y-2">
                {disputes.map(d => (
                  <div key={d.id} className="px-3 py-2 rounded-lg text-xs space-y-1"
                    style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>{d.title}</span>
                      <span className="px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{
                          background: d.status === 'OPEN' ? '#fffbeb' : '#f0fdf4',
                          color:      d.status === 'OPEN' ? '#d97706' : '#16a34a',
                          border:     `1px solid ${d.status === 'OPEN' ? '#fde68a' : '#bbf7d0'}`,
                        }}>
                        {d.status}
                      </span>
                    </div>
                    {d.description && (
                      <p style={{ color: 'var(--muted)' }}>{d.description}</p>
                    )}
                    <p style={{ color: 'var(--muted)' }}>
                      {new Date(d.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* --- Workflow Status --- */}
          <WorkflowPanel workflow={workflowData?.workflow ?? null} history={workflowData?.history} />

        </div>
      </div>
    </div>
  )
}

// WorkflowPanel is imported from @/components/shared/WorkflowPanel
