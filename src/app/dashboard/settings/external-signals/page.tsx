'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'CISO', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CISO'])

type SignalType    = 'NEWS' | 'STOCK_PRICE'
type SignalSev     = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

const SEV_COLOR: Record<SignalSev, { bg: string; text: string }> = {
  LOW:      { bg: '#f0fdf4', text: '#16a34a' },
  MEDIUM:   { bg: '#fff7ed', text: '#ea580c' },
  HIGH:     { bg: '#fef2f2', text: '#dc2626' },
  CRITICAL: { bg: '#450a0a', text: '#fca5a5' },
}

const TYPE_COLOR: Record<SignalType, { bg: string; text: string }> = {
  NEWS:        { bg: '#eff6ff', text: '#2563eb' },
  STOCK_PRICE: { bg: '#fdf4ff', text: '#9333ea' },
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SignalConfig {
  id:                string
  isActive:          boolean
  signalTypes:       SignalType[]
  stockTicker:       string | null
  companyName:       string
  newsKeywords:      string[]
  severityThreshold: SignalSev
  alertRecipients:   { id: string; name: string | null; email: string }[]
  createdAt:         string
  updatedAt:         string
  entity:            { id: string; name: string }
}

interface IncomingSignal {
  id:               string
  signalType:       SignalType
  severity:         SignalSev
  title:            string
  summary:          string
  sourceUrl:        string | null
  sourceName:       string | null
  publishedAt:      string | null
  detectedAt:       string
  dismissed:        boolean
  affectedRiskScore: boolean
  reviewedAt:       string | null
  reviewer:         { id: string; name: string | null; email: string } | null
  entity:           { id: string; name: string }
}

interface EntityOption { id: string; name: string }
interface UserOption   { id: string; name: string | null; email: string }

// ── Config modal ─────────────────────────────────────────────────────────────

interface ConfigModalProps {
  initial:  SignalConfig | null
  entities: EntityOption[]
  users:    UserOption[]
  onSave:   (data: Record<string, unknown>) => Promise<void>
  onClose:  () => void
}

function ConfigModal({ initial, entities, users, onSave, onClose }: ConfigModalProps) {
  const isEdit = !!initial?.id

  const [entityId,    setEntityId]    = useState(initial?.entity.id       ?? '')
  const [companyName, setCompanyName] = useState(initial?.companyName     ?? '')
  const [ticker,      setTicker]      = useState(initial?.stockTicker     ?? '')
  const [watchNews,   setWatchNews]   = useState(initial ? initial.signalTypes.includes('NEWS')        : true)
  const [watchStock,  setWatchStock]  = useState(initial ? initial.signalTypes.includes('STOCK_PRICE') : false)
  const [keywords,    setKeywords]    = useState(initial?.newsKeywords.join(', ') ?? '')
  const [threshold,   setThreshold]   = useState<SignalSev>(initial?.severityThreshold ?? 'MEDIUM')
  const [recipients,  setRecipients]  = useState<Set<string>>(new Set(initial?.alertRecipients.map(r => r.id) ?? []))
  const [isActive,    setIsActive]    = useState(initial?.isActive ?? true)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  // Auto-fill companyName from entity selection when creating
  function handleEntityChange(id: string) {
    setEntityId(id)
    if (!isEdit && !companyName) {
      const ent = entities.find(e => e.id === id)
      if (ent) setCompanyName(ent.name)
    }
  }

  function toggleRecipient(id: string) {
    setRecipients(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isEdit && !entityId)  { setError('Entity is required.'); return }
    if (!companyName.trim())   { setError('Company name is required.'); return }
    if (!watchNews && !watchStock) { setError('Select at least one signal type.'); return }
    setSaving(true)
    setError(null)
    try {
      const signalTypes: SignalType[] = []
      if (watchNews)  signalTypes.push('NEWS')
      if (watchStock) signalTypes.push('STOCK_PRICE')

      await onSave({
        ...(isEdit ? {} : { entityId }),
        companyName,
        signalTypes,
        stockTicker:       watchStock && ticker ? ticker : null,
        newsKeywords:      watchNews ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
        severityThreshold: threshold,
        alertRecipients:   [...recipients],
        ...(isEdit ? { isActive } : {}),
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="rounded-2xl w-full max-w-lg overflow-y-auto"
        style={{ background: '#fff', border: '1px solid var(--border)', maxHeight: '90vh' }}>
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            {isEdit ? 'Edit Signal Config' : 'New Signal Config'}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Configure which external signals to monitor for this entity.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          {/* Entity (create only) */}
          {!isEdit && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Entity <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select value={entityId} onChange={e => handleEntityChange(e.target.value)} required
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                <option value="">Select entity…</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          )}

          {/* Company name */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
              Company Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} required
              placeholder="Used for news search"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>

          {/* Signal types */}
          <div>
            <label className="text-xs font-medium block mb-2" style={{ color: 'var(--muted)' }}>Signal Types</label>
            <div className="space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={watchNews} onChange={e => setWatchNews(e.target.checked)}
                  className="mt-0.5" style={{ accentColor: '#2563eb' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>News</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Monitor news articles mentioning the company.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={watchStock} onChange={e => setWatchStock(e.target.checked)}
                  className="mt-0.5" style={{ accentColor: '#2563eb' }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Stock Price</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Alert on significant stock price movements.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Ticker (conditional) */}
          {watchStock && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Stock Ticker
              </label>
              <input type="text" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="e.g. AAPL"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none font-mono"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
          )}

          {/* Keywords (conditional) */}
          {watchNews && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Additional News Keywords (comma-separated)
              </label>
              <input type="text" value={keywords} onChange={e => setKeywords(e.target.value)}
                placeholder="e.g. fraud, lawsuit, breach"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
          )}

          {/* Severity threshold */}
          <div>
            <label className="text-xs font-medium block mb-2" style={{ color: 'var(--muted)' }}>
              Minimum Severity to Alert
            </label>
            <div className="flex gap-2">
              {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as SignalSev[]).map(s => {
                const active = threshold === s
                const col    = SEV_COLOR[s]
                return (
                  <button key={s} type="button" onClick={() => setThreshold(s)}
                    className="flex-1 py-2 rounded-xl text-xs font-medium transition-all"
                    style={{
                      border:     active ? `2px solid ${col.text}` : '1px solid var(--border)',
                      background: active ? col.bg : 'var(--surface)',
                      color:      active ? col.text : 'var(--muted)',
                    }}>
                    {s}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Alert recipients */}
          {users.length > 0 && (
            <div>
              <label className="text-xs font-medium block mb-2" style={{ color: 'var(--muted)' }}>
                Alert Recipients
              </label>
              <div className="rounded-xl overflow-hidden max-h-40 overflow-y-auto"
                style={{ border: '1px solid var(--border)' }}>
                {users.map((u, i) => (
                  <label key={u.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors"
                    style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <input type="checkbox" checked={recipients.has(u.id)} onChange={() => toggleRecipient(u.id)}
                      style={{ accentColor: '#2563eb' }} />
                    <span className="text-sm" style={{ color: 'var(--ink)' }}>
                      {u.name ?? u.email}
                      {u.name && <span className="ml-1 text-xs" style={{ color: 'var(--muted)' }}>{u.email}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Active toggle (edit only) */}
          {isEdit && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                style={{ accentColor: '#2563eb' }} />
              <span className="text-sm" style={{ color: 'var(--ink)' }}>Config is active</span>
            </label>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
              style={{ background: '#2563eb', color: '#fff' }}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Config'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExternalSignalsPage() {
  const user = useUser()

  const [tab,         setTab]         = useState<'configs' | 'feed'>('configs')
  const [configs,     setConfigs]     = useState<SignalConfig[]>([])
  const [signals,     setSignals]     = useState<IncomingSignal[]>([])
  const [sigTotal,    setSigTotal]    = useState(0)
  const [entities,    setEntities]    = useState<EntityOption[]>([])
  const [users,       setUsers]       = useState<UserOption[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [modal,       setModal]       = useState<'new' | SignalConfig | null>(null)
  const [toDelete,    setToDelete]    = useState<SignalConfig | null>(null)
  const [deleting,    setDeleting]    = useState(false)

  // Feed filters
  const [sigType,      setSigType]      = useState('')
  const [sigSev,       setSigSev]       = useState('')
  const [showDismissed,setShowDismissed]= useState(false)
  const [sigPage,      setSigPage]      = useState(1)

  const canWrite = WRITE_ROLES.has(user.role ?? '')

  const loadConfigs = useCallback(async () => {
    try {
      const [cfgRes, entRes, usrRes] = await Promise.all([
        fetch('/api/external-signals/configs'),
        fetch('/api/entities?pageSize=200'),
        fetch('/api/users'),
      ])
      if (cfgRes.ok) { const d = await cfgRes.json(); setConfigs(d.configs) }
      if (entRes.ok) { const d = await entRes.json(); setEntities(d.entities ?? d.data ?? []) }
      if (usrRes.ok) { const d = await usrRes.json(); setUsers(d.users ?? d ?? []) }
    } catch {
      setError('Could not load configurations.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSignals = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(sigPage) })
    if (sigType) p.set('type', sigType)
    if (sigSev)  p.set('severity', sigSev)
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
      setLoading(false)
    }
  }, [sigType, sigSev, showDismissed, sigPage])

  useEffect(() => { loadConfigs() }, [loadConfigs])
  useEffect(() => { if (tab === 'feed') loadSignals() }, [tab, loadSignals])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  async function handleSaveConfig(data: Record<string, unknown>) {
    const editing = modal !== 'new' && modal !== null
    const res = await fetch(
      editing ? `/api/external-signals/configs/${(modal as SignalConfig).id}` : '/api/external-signals/configs',
      { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
    )
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error?.message ?? 'Save failed')
    }
    setModal(null)
    await loadConfigs()
  }

  async function handleDeleteConfig() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await fetch(`/api/external-signals/configs/${toDelete.id}`, { method: 'DELETE' })
      setToDelete(null)
      await loadConfigs()
    } finally {
      setDeleting(false)
    }
  }

  async function dismissSignal(id: string, dismissed: boolean) {
    await fetch(`/api/external-signals/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed }),
    })
    await loadSignals()
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  const activeSigCount = signals.filter(s => !s.dismissed).length

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>External Signals</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Monitor news, stock price movements, and other external data feeds for your entities.
          </p>
        </div>
        {canWrite && tab === 'configs' && (
          <button onClick={() => setModal('new')}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Config
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border)' }}>
        {[
          { key: 'configs', label: `Configurations (${configs.length})` },
          { key: 'feed',    label: `Signal Feed${activeSigCount > 0 ? ` (${activeSigCount} active)` : ''}` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key as typeof tab)}
            className="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{
              borderColor: tab === key ? '#2563eb' : 'transparent',
              color:       tab === key ? '#2563eb' : 'var(--muted)',
            }}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* ── Configurations tab ─────────────────────────────────────────────── */}
      {tab === 'configs' && (
        loading ? (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : configs.length === 0 ? (
          <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
            <p className="text-lg font-medium mb-1">No signal configs</p>
            <p className="text-sm">Add a config to start monitoring external signals for an entity.</p>
            {canWrite && (
              <button onClick={() => setModal('new')} className="text-sm mt-3 inline-block" style={{ color: '#2563eb' }}>
                Create first config →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {configs.map(cfg => (
              <div key={cfg.id} className="rounded-2xl p-5"
                style={{
                  border:     `1px solid ${cfg.isActive ? 'var(--border)' : '#e2e8f0'}`,
                  background: cfg.isActive ? '#fff' : '#f8fafc',
                  opacity:    cfg.isActive ? 1 : 0.75,
                }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm" style={{ color: 'var(--ink)' }}>
                        {cfg.entity.name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>·</span>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>{cfg.companyName}</span>
                      {cfg.stockTicker && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                          style={{ background: '#f1f5f9', color: '#475569' }}>
                          {cfg.stockTicker}
                        </span>
                      )}
                      {!cfg.isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: '#f1f5f9', color: '#94a3b8' }}>Inactive</span>
                      )}
                    </div>

                    {/* Signal type badges */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {cfg.signalTypes.map(t => {
                        const col = TYPE_COLOR[t]
                        return (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ background: col.bg, color: col.text }}>
                            {t === 'STOCK_PRICE' ? 'Stock Price' : 'News'}
                          </span>
                        )
                      })}
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: SEV_COLOR[cfg.severityThreshold].bg, color: SEV_COLOR[cfg.severityThreshold].text }}>
                        ≥ {cfg.severityThreshold}
                      </span>
                    </div>

                    {/* Keywords */}
                    {cfg.newsKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {cfg.newsKeywords.map(kw => (
                          <span key={kw} className="text-xs px-1.5 py-0.5 rounded font-mono"
                            style={{ background: '#f1f5f9', color: '#475569' }}>
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Recipients */}
                    {cfg.alertRecipients.length > 0 && (
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        Alerts → {cfg.alertRecipients.map(r => r.name ?? r.email).join(', ')}
                      </p>
                    )}
                  </div>

                  {canWrite && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => setModal(cfg)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium"
                        style={{ border: '1px solid #2563eb22', background: '#eff6ff', color: '#2563eb' }}>
                        Edit
                      </button>
                      <button onClick={() => setToDelete(cfg)}
                        className="px-3 py-1.5 rounded-xl text-xs"
                        style={{ border: '1px solid #fecaca', color: '#dc2626' }}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Signal feed tab ────────────────────────────────────────────────── */}
      {tab === 'feed' && (
        <>
          {/* Feed filters */}
          <div className="flex gap-3 mb-5 flex-wrap items-center">
            <select value={sigType} onChange={e => { setSigType(e.target.value); setSigPage(1) }}
              className="px-3 py-1.5 rounded-xl text-xs outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
              <option value="">All Types</option>
              <option value="NEWS">News</option>
              <option value="STOCK_PRICE">Stock Price</option>
            </select>

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

          {loading ? (
            <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
          ) : signals.length === 0 ? (
            <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
              <p className="text-lg font-medium mb-1">No signals</p>
              <p className="text-sm">Signals will appear here as they are detected for configured entities.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {signals.map(sig => {
                  const tCol = TYPE_COLOR[sig.signalType]
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
                              style={{ background: tCol.bg, color: tCol.text }}>
                              {sig.signalType === 'STOCK_PRICE' ? 'Stock Price' : 'News'}
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ background: sCol.bg, color: sCol.text }}>
                              {sig.severity}
                            </span>
                            <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>
                              {sig.entity.name}
                            </span>
                            {sig.affectedRiskScore && (
                              <span className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: '#fef2f2', color: '#dc2626' }}>
                                Risk score affected
                              </span>
                            )}
                            {sig.dismissed && (
                              <span className="text-xs px-1.5 py-0.5 rounded"
                                style={{ background: '#f1f5f9', color: '#94a3b8' }}>Dismissed</span>
                            )}
                          </div>

                          <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--ink)' }}>
                            {sig.title}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>{sig.summary}</p>

                          <div className="flex gap-3 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                            {sig.sourceName && <span>{sig.sourceName}</span>}
                            {sig.publishedAt && <span>{fmtDate(sig.publishedAt)}</span>}
                            <span>Detected {fmtDateTime(sig.detectedAt)}</span>
                            {sig.reviewer && <span>Reviewed by {sig.reviewer.name ?? sig.reviewer.email}</span>}
                            {sig.sourceUrl && (
                              <a href={sig.sourceUrl} target="_blank" rel="noopener noreferrer"
                                className="hover:underline" style={{ color: '#2563eb' }}>
                                Source ↗
                              </a>
                            )}
                          </div>
                        </div>

                        {canWrite && (
                          <button onClick={() => dismissSignal(sig.id, !sig.dismissed)}
                            className="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs"
                            style={{
                              border:     '1px solid var(--border)',
                              color:      sig.dismissed ? '#16a34a' : 'var(--muted)',
                              background: 'var(--surface)',
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
                  <button onClick={() => setSigPage(p => Math.max(1, p - 1))} disabled={sigPage === 1}
                    className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Previous</button>
                  <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                    Page {sigPage} of {Math.ceil(sigTotal / 50)}
                  </span>
                  <button onClick={() => setSigPage(p => p + 1)} disabled={sigPage >= Math.ceil(sigTotal / 50)}
                    className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Config modal */}
      {modal !== null && (
        <ConfigModal
          initial={modal === 'new' ? null : modal}
          entities={entities}
          users={users}
          onSave={handleSaveConfig}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirmation */}
      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Delete Config</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
              Remove signal monitoring for <strong>{toDelete.entity.name}</strong>?
              Historical signals will be retained.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setToDelete(null)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Cancel</button>
              <button disabled={deleting} onClick={handleDeleteConfig}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: '#dc2626', color: '#fff' }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
