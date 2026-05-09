'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'CISO', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CISO'])

type SignalSev = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

const SEV_COLOR: Record<SignalSev, { bg: string; text: string }> = {
  LOW:      { bg: '#f0fdf4', text: '#16a34a' },
  MEDIUM:   { bg: '#fff7ed', text: '#ea580c' },
  HIGH:     { bg: '#fef2f2', text: '#dc2626' },
  CRITICAL: { bg: '#450a0a', text: '#fca5a5' },
}

interface IncomingSignal {
  id:               string
  severity:         SignalSev
  title:            string
  summary:          string
  sourceUrl:        string | null
  sourceName:       string | null
  detectedAt:       string
  dismissed:        boolean
  affectedRiskScore: boolean
  reviewedAt:       string | null
  reviewer:         { id: string; name: string | null; email: string } | null
  entity:           { id: string; name: string }
}

interface MonitoredEntity {
  id:          string
  name:        string
  stockTicker: string
  status:      string
}

export default function ExternalSignalsPage() {
  const user = useUser()

  const [tab,             setTab]             = useState<'feed' | 'monitored'>('feed')
  const [signals,         setSignals]         = useState<IncomingSignal[]>([])
  const [sigTotal,        setSigTotal]        = useState(0)
  const [monitored,       setMonitored]       = useState<MonitoredEntity[]>([])
  const [loadingFeed,     setLoadingFeed]     = useState(false)
  const [loadingMonitored,setLoadingMonitored]= useState(false)
  const [error,           setError]           = useState<string | null>(null)

  // Feed filters
  const [sigSev,          setSigSev]          = useState('')
  const [showDismissed,   setShowDismissed]   = useState(false)
  const [sigPage,         setSigPage]         = useState(1)
  const [monitoredLoaded, setMonitoredLoaded] = useState(false)

  const canWrite = WRITE_ROLES.has(user.role ?? '')

  const loadSignals = useCallback(async () => {
    setLoadingFeed(true)
    setError(null)
    const p = new URLSearchParams({ page: String(sigPage), type: 'STOCK_PRICE' })
    if (sigSev) p.set('severity', sigSev)
    if (!showDismissed) p.set('dismissed', 'false')
    try {
      const res = await fetch(`/api/external-signals?${p}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setSignals(d.signals)
      setSigTotal(d.total)
    } catch {
      setError('Could not load signals.')
    } finally {
      setLoadingFeed(false)
    }
  }, [sigSev, showDismissed, sigPage])

  useEffect(() => {
    if (tab === 'feed') loadSignals()
  }, [tab, loadSignals])

  useEffect(() => {
    if (tab !== 'monitored' || monitoredLoaded) return
    setLoadingMonitored(true)
    fetch('/api/entities?limit=500')
      .then(r => r.json())
      .then(d => {
        const all: MonitoredEntity[] = (d.entities ?? [])
          .filter((e: { stockTicker?: string | null }) => e.stockTicker)
          .map((e: { id: string; name: string; stockTicker: string; status: string }) => ({
            id:          e.id,
            name:        e.name,
            stockTicker: e.stockTicker,
            status:      e.status,
          }))
        setMonitored(all)
        setMonitoredLoaded(true)
      })
      .catch(() => { setMonitoredLoaded(true) })
      .finally(() => setLoadingMonitored(false))
  }, [tab, monitoredLoaded])

  async function dismissSignal(id: string, dismissed: boolean) {
    await apiClient(`/api/external-signals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed }),
    })
    await loadSignals()
  }

  function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  const activeCount = signals.filter(s => !s.dismissed).length

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>External Signals</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Stock price movements are monitored automatically for every entity that has a ticker set.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--border)' }}>
        {([
          { key: 'feed',      label: activeCount > 0 ? `Signal Feed (${activeCount} active)` : 'Signal Feed' },
          { key: 'monitored', label: `Monitored Entities${monitoredLoaded ? ` (${monitored.length})` : ''}` },
        ] as const).map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{
              color:        tab === t.key ? '#2563eb' : 'var(--muted)',
              fontWeight:   tab === t.key ? 600 : 400,
              borderBottom: tab === t.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none', border: 'none', borderBottomStyle: 'solid',
              cursor: 'pointer', padding: '8px 16px', fontSize: 14, marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* ── Signal Feed ────────────────────────────────────────────────────────── */}
      {tab === 'feed' && (
        <>
          <div className="flex gap-3 mb-5 flex-wrap items-center">
            <select value={sigSev} onChange={e => { setSigSev(e.target.value); setSigPage(1) }}
              className="px-3 py-1.5 rounded-xl text-xs outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
              <option value="">All Severities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>

            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
              <input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)}
                style={{ accentColor: '#2563eb' }} />
              Show dismissed
            </label>

            <span className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>
              {sigTotal} signal{sigTotal !== 1 ? 's' : ''}
            </span>
          </div>

          {loadingFeed ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
          ) : signals.length === 0 ? (
            <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
              <p className="text-lg font-medium mb-1">No signals</p>
              <p className="text-sm">
                Stock price signals will appear here once the nightly batch runs for entities with a ticker.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {signals.map(sig => {
                  const sCol = SEV_COLOR[sig.severity]
                  return (
                    <div key={sig.id} className="rounded-2xl p-4"
                      style={{
                        border:     '1px solid var(--border)',
                        background: sig.dismissed ? '#f8fafc' : '#fff',
                        opacity:    sig.dismissed ? 0.7 : 1,
                      }}>
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ background: '#fdf4ff', color: '#9333ea' }}>
                              Stock Price
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ background: sCol.bg, color: sCol.text }}>
                              {sig.severity}
                            </span>
                            <Link href={`/dashboard/entities/${sig.entity.id}`}
                              className="text-xs font-medium hover:underline"
                              style={{ color: 'var(--ink)' }}>
                              {sig.entity.name}
                            </Link>
                            {sig.affectedRiskScore && (
                              <span className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: '#fef2f2', color: '#dc2626' }}>
                                Risk score affected
                              </span>
                            )}
                            {sig.dismissed && (
                              <span className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: '#f1f5f9', color: '#94a3b8' }}>
                                Dismissed
                              </span>
                            )}
                          </div>

                          <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--ink)' }}>
                            {sig.title}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>{sig.summary}</p>

                          <div className="flex gap-3 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                            {sig.sourceName && <span>{sig.sourceName}</span>}
                            <span>Detected {fmtDateTime(sig.detectedAt)}</span>
                            {sig.reviewer && (
                              <span>Reviewed by {sig.reviewer.name ?? sig.reviewer.email}</span>
                            )}
                          </div>
                        </div>

                        {canWrite && (
                          <button type="button" onClick={() => dismissSignal(sig.id, !sig.dismissed)}
                            className="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs"
                            style={{
                              border:     '1px solid var(--border)',
                              color:      sig.dismissed ? '#16a34a' : 'var(--muted)',
                              background: 'var(--surface)',
                              cursor:     'pointer',
                            }}>
                            {sig.dismissed ? 'Restore' : 'Dismiss'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {sigTotal > 50 && (
                <div className="flex justify-center gap-2 mt-6">
                  <button type="button"
                    onClick={() => setSigPage(p => Math.max(1, p - 1))} disabled={sigPage === 1}
                    className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
                    Previous
                  </button>
                  <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                    Page {sigPage} of {Math.ceil(sigTotal / 50)}
                  </span>
                  <button type="button"
                    onClick={() => setSigPage(p => p + 1)}
                    disabled={sigPage >= Math.ceil(sigTotal / 50)}
                    className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Monitored Entities ─────────────────────────────────────────────────── */}
      {tab === 'monitored' && (
        <>
          <div className="mb-5 px-4 py-3 rounded-xl text-sm"
            style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
            Monitoring is automatic — any entity with a stock ticker set will be included in the nightly batch.
            To add or remove an entity, edit the ticker field on the{' '}
            <Link href="/dashboard/entities" className="underline">entity page</Link>.
          </div>

          {loadingMonitored ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
          ) : monitored.length === 0 ? (
            <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
              <p className="text-lg font-medium mb-1">No entities with tickers</p>
              <p className="text-sm">
                Open an entity and set a stock ticker to enable price monitoring.
              </p>
              <Link href="/dashboard/entities"
                className="text-sm mt-3 inline-block" style={{ color: '#2563eb' }}>
                Go to Entities →
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                    {['Entity', 'Ticker', 'Status'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide"
                        style={{ color: 'var(--muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monitored.map((e, i) => (
                    <tr key={e.id}
                      style={{ borderBottom: i < monitored.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/entities/${e.id}`}
                          className="font-medium hover:underline" style={{ color: 'var(--ink)' }}>
                          {e.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs px-2 py-0.5 rounded"
                          style={{ background: '#fdf4ff', color: '#9333ea' }}>
                          {e.stockTicker}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {e.status.replace(/_/g, ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
