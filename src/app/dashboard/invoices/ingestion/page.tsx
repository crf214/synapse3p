'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AP_CLERK'])
const REPLAY_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

type ProcessingStatus = 'PENDING' | 'PARSED' | 'FAILED'
type InvoiceSource    = 'EMAIL' | 'PORTAL' | 'MANUAL'

interface AttachmentRef {
  filename:   string
  storageRef: string
  mimeType:   string
}

interface IngestionEvent {
  id:               string
  source:           InvoiceSource
  processingStatus: ProcessingStatus
  fromEmail:        string | null
  fromName:         string | null
  subject:          string | null
  attachmentRefs:   AttachmentRef[] | null
  errorDetails:     string | null
  receivedAt:       string
  invoice:          { id: string; invoiceNo: string; status: string; amount: number; currency: string } | null
}

const SOURCE_LABEL: Record<InvoiceSource, string> = {
  EMAIL:  '✉ Email',
  PORTAL: '↑ Upload',
  MANUAL: '✎ Manual',
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

// ---------------------------------------------------------------------------
// Expandable log row (used in both sections)
// ---------------------------------------------------------------------------
function EventRow({
  ev, canReplay, onAction, actionId,
}: {
  ev: IngestionEvent
  canReplay: boolean
  onAction: (id: string, action: 'replay' | 'dismiss') => void
  actionId: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const isBusy = actionId === ev.id
  const attachments = ev.attachmentRefs ?? []

  const statusStyle =
    ev.processingStatus === 'FAILED'  ? { bg: '#fef2f2', text: '#dc2626', label: 'Failed'  } :
    ev.processingStatus === 'PENDING' ? { bg: '#fff7ed', text: '#ea580c', label: 'Pending' } :
                                        { bg: '#f0fdf4', text: '#16a34a', label: 'Parsed'  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: '#fff' }}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status */}
        <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium w-16 text-center"
          style={{ background: statusStyle.bg, color: statusStyle.text }}>
          {statusStyle.label}
        </span>

        {/* Source */}
        <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full"
          style={{ background: '#f1f5f9', color: '#475569' }}>
          {SOURCE_LABEL[ev.source]}
        </span>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
            {ev.subject ?? ev.fromEmail ?? '(no subject)'}
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
            {ev.fromName ? `${ev.fromName} · ` : ''}{ev.fromEmail ?? '—'}
            {attachments.length > 0 && (
              <span className="ml-2">{attachments.length} attachment{attachments.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>

        {/* Invoice link */}
        {ev.invoice && (
          <Link href={`/dashboard/invoices/${ev.invoice.id}/review`}
            className="flex-shrink-0 text-xs font-medium hover:underline"
            style={{ color: '#2563eb' }}>
            {ev.invoice.invoiceNo} →
          </Link>
        )}

        {/* Timestamp */}
        <span className="flex-shrink-0 text-xs" style={{ color: 'var(--muted)' }}>
          {fmtDateTime(ev.receivedAt)}
        </span>

        {/* Actions */}
        <div className="flex gap-1.5 flex-shrink-0">
          <button onClick={() => setExpanded(x => !x)}
            className="px-2.5 py-1 rounded-lg text-xs"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
            {expanded ? 'Hide' : 'Details'}
          </button>
          {canReplay && ev.processingStatus === 'FAILED' && (
            <button disabled={isBusy} onClick={() => onAction(ev.id, 'replay')}
              className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
              {isBusy ? 'Retrying…' : 'Retry'}
            </button>
          )}
          {canReplay && ev.processingStatus === 'FAILED' && (
            <button disabled={isBusy} onClick={() => onAction(ev.id, 'dismiss')}
              className="px-2.5 py-1 rounded-lg text-xs disabled:opacity-40"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t space-y-3"
          style={{ borderColor: 'var(--border)', background: '#fafafa' }}>

          {ev.errorDetails && (
            <div className="rounded-xl px-3 py-2" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
              <p className="text-xs font-medium mb-1" style={{ color: '#dc2626' }}>Error detail</p>
              <pre className="text-xs whitespace-pre-wrap font-mono" style={{ color: '#dc2626' }}>
                {ev.errorDetails}
              </pre>
            </div>
          )}

          {attachments.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Attachments</p>
              <div className="space-y-1">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink)' }}>
                    <span className="font-mono">{a.filename}</span>
                    <span style={{ color: 'var(--muted)' }}>{a.mimeType}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ev.invoice && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Linked Invoice</p>
              <div className="flex items-center gap-3 text-xs">
                <Link href={`/dashboard/invoices/${ev.invoice.id}/review`}
                  className="font-medium hover:underline" style={{ color: '#2563eb' }}>
                  {ev.invoice.invoiceNo}
                </Link>
                <span className="px-2 py-0.5 rounded-full"
                  style={{ background: '#f1f5f9', color: '#475569' }}>
                  {ev.invoice.status.replace(/_/g, ' ')}
                </span>
                <span style={{ color: 'var(--muted)' }}>
                  {fmt(ev.invoice.amount, ev.invoice.currency)}
                </span>
              </div>
            </div>
          )}

          <p className="text-xs font-mono" style={{ color: 'var(--muted)' }}>ID: {ev.id}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function IngestionMonitorPage() {
  const user     = useUser()
  const canReplay = REPLAY_ROLES.has(user.role ?? '')

  // Pending / failed — needs human attention
  const [attention,      setAttention]      = useState<IngestionEvent[]>([])
  const [attentionTotal, setAttentionTotal] = useState(0)
  const [attentionLoading, setAttentionLoading] = useState(true)

  // Parsed — transaction log
  const [log,        setLog]        = useState<IngestionEvent[]>([])
  const [logTotal,   setLogTotal]   = useState(0)
  const [logPage,    setLogPage]    = useState(1)
  const [logSource,  setLogSource]  = useState('')
  const [logLoading, setLogLoading] = useState(true)

  const [actionId, setActionId] = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  const loadAttention = useCallback(async () => {
    setAttentionLoading(true)
    try {
      const res = await fetch('/api/invoices/ingestion-events?status=PENDING&limit=100')
      const failRes = await fetch('/api/invoices/ingestion-events?status=FAILED&limit=100')
      if (!res.ok || !failRes.ok) throw new Error()
      const [pd, fd] = await Promise.all([res.json(), failRes.json()])
      const combined = [...(fd.events ?? []), ...(pd.events ?? [])]
        .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
      setAttention(combined)
      setAttentionTotal((fd.total ?? 0) + (pd.total ?? 0))
    } catch {
      setError('Could not load ingestion events.')
    } finally {
      setAttentionLoading(false)
    }
  }, [])

  const loadLog = useCallback(async () => {
    setLogLoading(true)
    try {
      const p = new URLSearchParams({ status: 'PARSED', page: String(logPage) })
      if (logSource) p.set('source', logSource)
      const res = await fetch(`/api/invoices/ingestion-events?${p}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setLog(d.events ?? [])
      setLogTotal(d.total ?? 0)
    } catch {
      setError('Could not load ingestion log.')
    } finally {
      setLogLoading(false)
    }
  }, [logPage, logSource])

  useEffect(() => { loadAttention() }, [loadAttention])
  useEffect(() => { loadLog() },       [loadLog])

  async function doAction(id: string, action: 'replay' | 'dismiss') {
    setActionId(id)
    try {
      const res = await fetch(`/api/invoices/ingestion-events/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'Action failed')
      await loadAttention()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionId(null)
    }
  }

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  const logPages = Math.ceil(logTotal / 50)

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard/invoices" className="text-sm" style={{ color: 'var(--muted)' }}>Invoices</Link>
          <span style={{ color: 'var(--muted)' }}>›</span>
          <span className="text-sm" style={{ color: 'var(--ink)' }}>Ingestion Monitor</span>
        </div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Invoice Ingestion Monitor</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Tracks the automated intake of invoices from email and file uploads into the invoice pipeline.
          Successful ingestions appear in the <Link href="/dashboard/invoices" className="underline" style={{ color: '#2563eb' }}>Invoices</Link> tab.
          Items below requiring your attention could not complete automatically.
        </p>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* ── Section 1: Needs Attention ──────────────────────────────────────── */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            Needs Attention
          </h2>
          {attentionTotal > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {attentionTotal} item{attentionTotal !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
          These invoices failed to process automatically or are awaiting pipeline completion.
          Review the error detail and retry, or dismiss if the item is no longer relevant.
        </p>

        {attentionLoading ? (
          <div className="text-sm py-6" style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : attention.length === 0 ? (
          <div className="py-8 text-center rounded-xl" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <p className="text-sm font-medium mb-0.5" style={{ color: '#16a34a' }}>All clear</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>No invoices are pending or failed.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {attention.map(ev => (
              <EventRow key={ev.id} ev={ev} canReplay={canReplay} onAction={doAction} actionId={actionId} />
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Ingestion Log ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>Ingestion Log</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Successfully processed invoices. Click any row to view the linked invoice.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={logSource} onChange={e => { setLogSource(e.target.value); setLogPage(1) }}
              className="px-3 py-1.5 rounded-lg text-xs outline-none"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)' }}>
              <option value="">All sources</option>
              <option value="EMAIL">Email</option>
              <option value="PORTAL">Upload</option>
              <option value="MANUAL">Manual</option>
            </select>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {logTotal} record{logTotal !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {logLoading ? (
          <div className="text-sm py-6" style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : log.length === 0 ? (
          <div className="py-8 text-center rounded-xl" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No processed ingestions yet.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {log.map(ev => (
                <EventRow key={ev.id} ev={ev} canReplay={canReplay} onAction={doAction} actionId={actionId} />
              ))}
            </div>

            {logPages > 1 && (
              <div className="flex items-center justify-between mt-5">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Page {logPage} of {logPages}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage === 1}
                    className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                    Previous
                  </button>
                  <button onClick={() => setLogPage(p => p + 1)} disabled={logPage >= logPages}
                    className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
