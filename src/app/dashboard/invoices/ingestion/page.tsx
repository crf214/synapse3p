'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AP_CLERK'])
const REPLAY_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

type ProcessingStatus = 'PENDING' | 'PARSED' | 'FAILED'
type InvoiceSource    = 'EMAIL' | 'UPLOAD' | 'MANUAL'

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

const STATUS_COLOR: Record<ProcessingStatus, { bg: string; text: string }> = {
  PENDING: { bg: '#fff7ed', text: '#ea580c' },
  PARSED:  { bg: '#f0fdf4', text: '#16a34a' },
  FAILED:  { bg: '#fef2f2', text: '#dc2626' },
}

const SOURCE_LABEL: Record<InvoiceSource, string> = {
  EMAIL:  'Email',
  UPLOAD: 'Upload',
  MANUAL: 'Manual',
}

export default function IngestionMonitorPage() {
  const user = useUser()

  const [events,      setEvents]      = useState<IngestionEvent[]>([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [page,        setPage]        = useState(1)
  const [actionId,    setActionId]    = useState<string | null>(null)
  const [expanded,    setExpanded]    = useState<string | null>(null)

  const canReplay = REPLAY_ROLES.has(user.role ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(page) })
    if (statusFilter) p.set('status', statusFilter)
    if (sourceFilter) p.set('source', sourceFilter)
    try {
      const res = await fetch(`/api/invoices/ingestion-events?${p}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setEvents(d.events)
      setTotal(d.total)
    } catch {
      setError('Could not load ingestion events.')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, sourceFilter])

  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

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
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionId(null)
    }
  }

  function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  const failCount = events.filter(e => e.processingStatus === 'FAILED').length

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/dashboard/invoices" className="text-sm" style={{ color: 'var(--muted)' }}>
              Invoices
            </Link>
            <span style={{ color: 'var(--muted)' }}>›</span>
            <span className="text-sm" style={{ color: 'var(--ink)' }}>Ingestion Monitor</span>
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Ingestion Monitor</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Email and upload ingestion events — view failures and replay the pipeline.
          </p>
        </div>
        {failCount > 0 && (
          <div className="px-3 py-1.5 rounded-xl text-sm font-medium"
            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
            {failCount} failed on this page
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-xl text-xs outline-none"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PARSED">Parsed</option>
          <option value="FAILED">Failed</option>
        </select>

        <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 rounded-xl text-xs outline-none"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
          <option value="">All Sources</option>
          <option value="EMAIL">Email</option>
          <option value="UPLOAD">Upload</option>
          <option value="MANUAL">Manual</option>
        </select>

        <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>
          {total} event{total !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No events</p>
          <p className="text-sm">Ingestion events will appear here as emails or uploads arrive.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {events.map(ev => {
              const sCol      = STATUS_COLOR[ev.processingStatus]
              const isExpanded = expanded === ev.id
              const isBusy    = actionId === ev.id
              const attachments = ev.attachmentRefs ?? []

              return (
                <div key={ev.id} className="rounded-2xl overflow-hidden"
                  style={{ border: '1px solid var(--border)', background: '#fff' }}>

                  {/* Row */}
                  <div className="flex items-center gap-4 px-4 py-3">
                    {/* Status badge */}
                    <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium w-16 text-center"
                      style={{ background: sCol.bg, color: sCol.text }}>
                      {ev.processingStatus}
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
                          <span className="ml-2">
                            {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Invoice link */}
                    {ev.invoice && (
                      <Link href={`/dashboard/invoices/${ev.invoice.id}`}
                        className="flex-shrink-0 text-xs hover:underline"
                        style={{ color: '#2563eb' }}>
                        {ev.invoice.invoiceNo}
                      </Link>
                    )}

                    {/* Timestamp */}
                    <span className="flex-shrink-0 text-xs" style={{ color: 'var(--muted)' }}>
                      {fmtDateTime(ev.receivedAt)}
                    </span>

                    {/* Actions */}
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => setExpanded(isExpanded ? null : ev.id)}
                        className="px-2.5 py-1 rounded-lg text-xs"
                        style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                      {canReplay && ev.processingStatus === 'FAILED' && (
                        <button disabled={isBusy} onClick={() => doAction(ev.id, 'replay')}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
                          style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
                          {isBusy ? 'Replaying…' : 'Replay'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t space-y-3"
                      style={{ borderColor: 'var(--border)', background: '#fafafa' }}>

                      {ev.errorDetails && (
                        <div className="rounded-xl px-3 py-2"
                          style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                          <p className="text-xs font-medium mb-0.5" style={{ color: '#dc2626' }}>Error</p>
                          <pre className="text-xs whitespace-pre-wrap font-mono"
                            style={{ color: '#dc2626' }}>
                            {ev.errorDetails}
                          </pre>
                        </div>
                      )}

                      {attachments.length > 0 && (
                        <div>
                          <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Attachments</p>
                          <div className="space-y-1">
                            {attachments.map((a, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs"
                                style={{ color: 'var(--ink)' }}>
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
                            <Link href={`/dashboard/invoices/${ev.invoice.id}`}
                              className="font-medium hover:underline" style={{ color: '#2563eb' }}>
                              {ev.invoice.invoiceNo}
                            </Link>
                            <span style={{ color: 'var(--muted)' }}>{ev.invoice.status}</span>
                            <span style={{ color: 'var(--muted)' }}>
                              {ev.invoice.currency} {Number(ev.invoice.amount).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="text-xs" style={{ color: 'var(--muted)' }}>
                        Event ID: <span className="font-mono">{ev.id}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Previous</button>
              <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
