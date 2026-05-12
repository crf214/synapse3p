'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { WorkflowPanel } from '@/components/shared/WorkflowPanel'
import type { WorkflowState, WorkflowHistoryEntry } from '@/components/shared/WorkflowPanel'

const ALLOWED_ROLES    = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES      = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const ONBOARDING_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'LEGAL', 'CISO', 'CFO', 'CONTROLLER'])
const OVERRIDE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type LegalStructure   = 'INDIVIDUAL' | 'COMPANY' | 'FUND' | 'TRUST' | 'GOVERNMENT' | 'OTHER'
type EntityStatus     = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW' | 'OFFBOARDED'
type EntityType       = 'VENDOR' | 'CONTRACTOR' | 'BROKER' | 'PLATFORM' | 'FUND_SVC_PROVIDER' | 'OTHER'
type KycStatus        = 'NOT_REQUIRED' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'FAILED' | 'EXPIRED'
type KybStatus        = 'NOT_REQUIRED' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'FAILED' | 'EXPIRED'
type SanctionsStatus  = 'CLEAR' | 'FLAGGED' | 'UNDER_REVIEW' | 'BLOCKED'
type SlaStatus        = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'NOT_APPLICABLE'
type ActivityType     = 'ONBOARDING' | 'REVIEW' | 'PAYMENT' | 'STATUS_CHANGE' | 'INCIDENT' | 'DOCUMENT' | 'NOTE' | 'EXTERNAL_SIGNAL' | 'RISK_SCORE_CHANGE'
type PaymentRail      = 'ACH' | 'BACS' | 'SWIFT' | 'SEPA' | 'WIRE' | 'STRIPE' | 'ERP' | 'OTHER'
type RiskBand         = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface EntityRef         { id: string; name: string; slug: string }
interface Classification    { id: string; type: EntityType; isPrimary: boolean; startDate: string | null; notes: string | null }
interface BankAccount       { id: string; label: string; accountName: string; accountNo: string; routingNo: string | null; swiftBic: string | null; iban: string | null; currency: string; paymentRail: PaymentRail; isPrimary: boolean; status: string }
interface DueDiligence      { ddLevel: number; kycStatus: KycStatus; kybStatus: KybStatus; sanctionsStatus: SanctionsStatus; pepStatus: boolean; nextReviewDate: string | null; reviewedAt: string | null; internalFactors: Record<string, unknown>; externalFactors: Record<string, unknown> }
interface RiskScore         { computedScore: number; ddScore: number; behaviorScore: number; sanctionsScore: number; paymentHistoryScore: number; weights: Record<string, number>; scoredAt: string; score: number | null; band: RiskBand | null; computedAt: string | null; factors: unknown; notes: string | null }
interface OrgRelationship   { onboardingStatus: string; activeForBillPay: boolean; portalAccess: boolean; approvedSpendLimit: number | null; contractStart: string | null; contractEnd: string | null }
interface ServiceEngagement { id: string; status: string; contractStart: string | null; contractEnd: string | null; slaStatus: SlaStatus; serviceCatalogue: { name: string; parentId: string | null } }
interface ActivityLog       { id: string; activityType: ActivityType; title: string; description: string | null; performedBy: string | null; occurredAt: string }

interface EntityDetail {
  id: string; name: string; slug: string; status: EntityStatus; legalStructure: LegalStructure
  jurisdiction: string | null; registrationNo: string | null; incorporationDate: string | null
  primaryCurrency: string; riskScore: number; riskOverride: boolean
  stockTicker: string | null
  // Risk band fields
  riskBand:               RiskBand | null
  riskBandUpdatedAt:      string | null
  riskBandOverride:       RiskBand | null
  riskBandOverrideReason: string | null
  riskBandOverrideBy:     string | null
  riskBandOverrideAt:     string | null
  parent:         EntityRef | null
  classifications:    Classification[]
  bankAccounts:       BankAccount[]
  dueDiligence:       DueDiligence | null
  financial:          { paymentTermsDays: number | null; taxId: string | null; vatNumber: string | null; glCode: string | null; costCentre: string | null } | null
  riskScores:         RiskScore[]
  orgRelationships:   OrgRelationship[]
  serviceEngagements: ServiceEngagement[]
  entityActivityLogs: ActivityLog[]
}

interface RiskHistoryRecord {
  id:           string
  entityId:     string
  computedScore: number
  score:        number | null
  band:         RiskBand | null
  computedAt:   string | null
  factors:      unknown
}

type TabKey = 'overview' | 'classifications' | 'bank-accounts' | 'due-diligence' | 'services' | 'activity' | 'risk-history' | 'workflow'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function relativeTime(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)  return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function riskColor(score: number) {
  if (score >= 7) return { bg: '#fef2f2', color: '#dc2626', border: '#dc262622' }
  if (score >= 4) return { bg: '#fffbeb', color: '#d97706', border: '#d9770622' }
  return              { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22' }
}

const RISK_BAND_STYLE: Record<RiskBand, { bg: string; color: string; border: string }> = {
  LOW:      { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22' },
  MEDIUM:   { bg: '#fffbeb', color: '#d97706', border: '#d9770622' },
  HIGH:     { bg: '#fff7ed', color: '#ea580c', border: '#ea580c22' },
  CRITICAL: { bg: '#fef2f2', color: '#dc2626', border: '#dc262622' },
}

function RiskBandBadge({ band }: { band: RiskBand | null }) {
  if (!band) {
    return <span className="text-xs" style={{ color: 'var(--muted)' }}>No band</span>
  }
  const s = RISK_BAND_STYLE[band]
  return (
    <span className="text-sm font-semibold px-3 py-1 rounded-xl"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {band}
    </span>
  )
}

function Badge({ label, bg, color, border }: { label: string; bg: string; color: string; border: string }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  )
}

const inputCls  = 'w-full text-sm px-3 py-2 rounded-lg outline-none'
const inputStyle = { background: '#fff', border: '1px solid var(--border)', color: 'var(--ink)' }
const labelStyle = { color: 'var(--muted)', fontSize: 12, fontWeight: 500, marginBottom: 4, display: 'block' as const }

// ---------------------------------------------------------------------------
// Entity search picker (for parent / ultimate parent)
// ---------------------------------------------------------------------------
function EntityPicker({
  label, value, entityId, onChange,
}: {
  label: string
  value: EntityRef | null
  entityId: string
  onChange: (e: EntityRef | null) => void
}) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<EntityRef[]>([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function search(q: string) {
    setQuery(q)
    if (!q.trim()) { setResults([]); setOpen(false); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/entities?search=${encodeURIComponent(q)}&limit=8`)
        const d   = await res.json() as { entities: EntityRef[] }
        setResults((d.entities ?? []).filter(e => e.id !== entityId))
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  function select(e: EntityRef) {
    onChange(e)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <span style={labelStyle}>{label}</span>
      {value ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: '#eff6ff', border: '1px solid #2563eb22' }}>
          <span className="flex-1 font-medium" style={{ color: '#2563eb' }}>{value.name}</span>
          <button type="button" onClick={() => onChange(null)}
            className="text-xs" style={{ color: '#2563eb' }}>
            ✕ Remove
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={e => search(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search entities…"
            className={inputCls}
            style={inputStyle}
          />
          {loading && (
            <span className="absolute right-3 top-2.5 text-xs" style={{ color: 'var(--muted)' }}>…</span>
          )}
          {open && results.length > 0 && (
            <div className="absolute z-10 w-full mt-1 rounded-xl shadow-lg overflow-hidden"
              style={{ background: '#fff', border: '1px solid var(--border)' }}>
              {results.map(e => (
                <button key={e.id} type="button"
                  onMouseDown={() => select(e)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                  style={{ color: 'var(--ink)' }}>
                  {e.name}
                  <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>{e.slug}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Risk Override Modal
// ---------------------------------------------------------------------------
function RiskOverrideModal({
  entityId, onClose, onSaved,
}: {
  entityId: string
  onClose:  () => void
  onSaved:  () => void
}) {
  const [band,      setBand]      = useState<RiskBand>('HIGH')
  const [reason,    setReason]    = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const MIN_REASON = 20
  const valid = reason.trim().length >= MIN_REASON

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true); setError(null)
    try {
      const res = await apiClient(`/api/entities/${entityId}/risk-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ band, reason: reason.trim() }),
      })
      const d = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(d.error?.message ?? 'Save failed')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const BANDS: RiskBand[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <h2 className="font-display text-lg" style={{ color: 'var(--ink)' }}>Override Risk Band</h2>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Manually set the risk band for this entity. This overrides the computed value until cleared.
        </p>
        <form onSubmit={submit} className="space-y-4">
          {/* Band selector */}
          <div>
            <span style={labelStyle}>Risk band *</span>
            <div className="flex gap-2 flex-wrap mt-1">
              {BANDS.map(b => {
                const s = RISK_BAND_STYLE[b]
                const active = band === b
                return (
                  <button key={b} type="button" onClick={() => setBand(b)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                    style={{
                      background: active ? s.bg : 'var(--surface)',
                      color:      active ? s.color : 'var(--muted)',
                      border:     active ? `2px solid ${s.color}` : '1px solid var(--border)',
                    }}>
                    {b}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Justification */}
          <div>
            <span style={labelStyle}>Justification * (min {MIN_REASON} characters)</span>
            <textarea
              className={inputCls}
              style={inputStyle}
              rows={4}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain the reason for this override…"
            />
            <div className="text-xs mt-1 text-right"
              style={{ color: reason.trim().length >= MIN_REASON ? '#16a34a' : 'var(--muted)' }}>
              {reason.trim().length} / {MIN_REASON}
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="text-sm px-4 py-2 rounded-xl"
              style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !valid}
              className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
              style={{ background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }}>
              {saving ? 'Saving…' : 'Apply override'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview Tab — full editable form
// ---------------------------------------------------------------------------
function OverviewTab({
  entity, canWrite, canOverride, onRefresh,
}: {
  entity:      EntityDetail
  canWrite:    boolean
  canOverride: boolean
  onRefresh:   () => void
}) {
  const [form, setForm] = useState({
    name:             entity.name,
    legalStructure:   entity.legalStructure,
    jurisdiction:     entity.jurisdiction     ?? '',
    registrationNo:   entity.registrationNo   ?? '',
    incorporationDate: entity.incorporationDate ? entity.incorporationDate.slice(0, 10) : '',
    primaryCurrency:  entity.primaryCurrency,
    status:           entity.status,
    stockTicker:      entity.stockTicker       ?? '',
    parent:           entity.parent            as EntityRef | null,
  })
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [showOverride,   setShowOverride]   = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)

  const latestRisk = entity.riskScores[0] ?? null

  // Parse factors from latest risk score
  const factors = (() => {
    if (!latestRisk?.factors) return null
    if (typeof latestRisk.factors !== 'object' || latestRisk.factors === null) return null
    const f = latestRisk.factors as Record<string, unknown>
    type Pillar = { score?: number; weight?: number; inputs?: unknown }
    const ec  = (f.entityCharacteristics  as Pillar | undefined) ?? null
    const fe  = (f.financialExposure       as Pillar | undefined) ?? null
    const qd  = (f.qualitativeDetermination as Pillar | undefined) ?? null
    if (!ec && !fe && !qd) return null
    return { ec, fe, qd }
  })()

  function setF(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setSaved(false)
      setForm(f => ({ ...f, [k]: e.target.value }))
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:             form.name,
          legalStructure:   form.legalStructure,
          jurisdiction:     form.jurisdiction     || null,
          registrationNo:   form.registrationNo   || null,
          incorporationDate: form.incorporationDate || null,
          primaryCurrency:  form.primaryCurrency,
          status:           form.status,
          stockTicker:      form.stockTicker       || null,
          parentId:         form.parent?.id        ?? null,
        }),
      })
      const d = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(d.error?.message ?? 'Save failed')
      setSaved(true)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function clearOverride() {
    setClearingOverride(true)
    try {
      const res = await apiClient(`/api/entities/${entity.id}/risk-override`, { method: 'DELETE' })
      const d = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(d.error?.message ?? 'Failed to clear override')
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear override')
    } finally {
      setClearingOverride(false)
    }
  }

  const CURRENCIES = ['USD', 'GBP', 'EUR', 'CHF', 'JPY', 'CAD', 'AUD', 'SGD', 'HKD', 'NZD']

  return (
    <div className="space-y-6">
      {/* ── Editable fields ─────────────────────────────────────────────── */}
      <form onSubmit={save}>
        <div className="rounded-2xl p-5 space-y-4" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Entity details</h3>
            {canWrite && (
              <div className="flex items-center gap-2">
                {saved && <span className="text-xs" style={{ color: '#16a34a' }}>✓ Saved</span>}
                {error && <span className="text-xs" style={{ color: '#dc2626' }}>{error}</span>}
                <button type="submit" disabled={saving}
                  className="text-sm font-medium px-4 py-1.5 rounded-lg disabled:opacity-50"
                  style={{ background: '#2563eb', color: '#fff' }}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label style={labelStyle}>Legal name</label>
              <input value={form.name} onChange={setF('name')} required
                disabled={!canWrite} className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }} />
            </div>

            <div>
              <label style={labelStyle}>Legal structure</label>
              <select value={form.legalStructure} onChange={setF('legalStructure')}
                disabled={!canWrite} className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }}>
                {(['INDIVIDUAL', 'COMPANY', 'FUND', 'TRUST', 'GOVERNMENT', 'OTHER'] as LegalStructure[]).map(s => (
                  <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Status</label>
              <select value={form.status} onChange={setF('status')}
                disabled={!canWrite} className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }}>
                {(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_REVIEW', 'OFFBOARDED'] as EntityStatus[]).map(s => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Jurisdiction</label>
              <input value={form.jurisdiction} onChange={setF('jurisdiction')}
                disabled={!canWrite} placeholder="e.g. Delaware, US" className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }} />
            </div>

            <div>
              <label style={labelStyle}>Registration No.</label>
              <input value={form.registrationNo} onChange={setF('registrationNo')}
                disabled={!canWrite} className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }} />
            </div>

            <div>
              <label style={labelStyle}>Incorporation date</label>
              <input type="date" value={form.incorporationDate} onChange={setF('incorporationDate')}
                disabled={!canWrite} className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }} />
            </div>

            <div>
              <label style={labelStyle}>Primary currency</label>
              <select value={form.primaryCurrency} onChange={setF('primaryCurrency')}
                disabled={!canWrite} className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Stock ticker</label>
              <input value={form.stockTicker} onChange={setF('stockTicker')}
                disabled={!canWrite} placeholder="e.g. AAPL, MSFT" className={inputCls}
                style={{ ...inputStyle, opacity: canWrite ? 1 : 0.7 }}
                maxLength={12} />
            </div>

            <div>
              <label style={labelStyle}>Internal slug</label>
              <input value={entity.slug} disabled className={inputCls}
                style={{ ...inputStyle, opacity: 0.5 }} />
            </div>
          </div>

          {/* Parent entity picker */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            {canWrite ? (
              <EntityPicker
                label="Parent entity"
                value={form.parent}
                entityId={entity.id}
                onChange={v => { setSaved(false); setForm(f => ({ ...f, parent: v })) }}
              />
            ) : (
              <div>
                <span style={labelStyle}>Parent entity</span>
                <div className="text-sm" style={{ color: 'var(--ink)' }}>{entity.parent?.name ?? '—'}</div>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* ── Risk score ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 space-y-4" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Risk</h3>
          {canOverride && (
            <div className="flex items-center gap-2">
              {entity.riskBandOverride && (
                <button
                  onClick={clearOverride}
                  disabled={clearingOverride}
                  className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
                  style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
                  {clearingOverride ? 'Clearing…' : 'Clear override'}
                </button>
              )}
              <button
                onClick={() => setShowOverride(true)}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Override band
              </button>
            </div>
          )}
        </div>

        {/* Override banner */}
        {entity.riskBandOverride && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
            style={{ background: '#fffbeb', border: '1px solid #d9770622' }}>
            <span className="text-sm" style={{ color: '#d97706' }}>&#9888;</span>
            <div className="text-xs" style={{ color: '#92400e' }}>
              <span className="font-semibold">Manual override active</span>
              {entity.riskBandOverrideReason && (
                <span> — {entity.riskBandOverrideReason}</span>
              )}
              {entity.riskBandOverrideBy && (
                <div className="mt-0.5" style={{ color: '#b45309' }}>
                  Set by {entity.riskBandOverrideBy}
                  {entity.riskBandOverrideAt && ` on ${fmt(entity.riskBandOverrideAt)}`}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Band badge + score */}
        <div className="flex items-center gap-3">
          <RiskBandBadge band={entity.riskBand} />
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            Score: <span className="font-mono tabular-nums" style={{ color: 'var(--ink)' }}>
              {entity.riskScore.toFixed(1)}
            </span>
          </div>
          {entity.riskBandUpdatedAt && (
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Updated {relativeTime(entity.riskBandUpdatedAt)}
            </div>
          )}
        </div>

        {/* Factor breakdown */}
        {factors ? (
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>Factor breakdown</div>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {['Pillar', 'Score', 'Weight'].map(h => (
                    <th key={h} className="text-left text-xs font-medium pb-2"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([
                  { key: 'entityCharacteristics',   label: 'Entity Characteristics',    pillar: factors.ec  },
                  { key: 'financialExposure',        label: 'Financial Exposure',         pillar: factors.fe  },
                  { key: 'qualitativeDetermination', label: 'Qualitative Determination',  pillar: factors.qd  },
                ] as { key: string; label: string; pillar: { score?: number; weight?: number } | null }[]).map(({ key, label, pillar }) => (
                  <tr key={key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="py-2 text-xs" style={{ color: 'var(--ink)' }}>{label}</td>
                    <td className="py-2 text-xs tabular-nums" style={{ color: 'var(--ink)' }}>
                      {pillar?.score != null ? pillar.score.toFixed(1) : '—'}
                    </td>
                    <td className="py-2 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                      {pillar?.weight != null ? `${(pillar.weight * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Risk score not yet computed.</p>
        )}
      </div>

      {/* ── Org relationship ─────────────────────────────────────────────── */}
      {entity.orgRelationships[0] && (() => {
        const rel = entity.orgRelationships[0]
        return (
          <div className="rounded-2xl p-5 space-y-0" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Relationship</h3>
            {[
              { label: 'Onboarding status', value: rel.onboardingStatus.replace('_', ' ') },
              { label: 'Bill-pay active',   value: rel.activeForBillPay ? 'Yes' : 'No' },
              { label: 'Portal access',     value: rel.portalAccess ? 'Enabled' : 'Disabled' },
              { label: 'Approved spend limit', value: rel.approvedSpendLimit != null ? `$${rel.approvedSpendLimit.toLocaleString()}` : '—' },
              { label: 'Contract start',    value: fmt(rel.contractStart) },
              { label: 'Contract end',      value: fmt(rel.contractEnd) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-2.5"
                style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-sm" style={{ color: 'var(--muted)' }}>{label}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{value}</span>
              </div>
            ))}
          </div>
        )
      })()}

      {showOverride && (
        <RiskOverrideModal
          entityId={entity.id}
          onClose={() => setShowOverride(false)}
          onSaved={() => { setShowOverride(false); onRefresh() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Classifications Tab
// ---------------------------------------------------------------------------
const TYPE_LABEL: Record<EntityType, string> = {
  VENDOR: 'Vendor', CONTRACTOR: 'Contractor', BROKER: 'Broker',
  PLATFORM: 'Platform', FUND_SVC_PROVIDER: 'Fund Svc Provider', OTHER: 'Other',
}
const ALL_TYPES: EntityType[] = ['VENDOR', 'CONTRACTOR', 'BROKER', 'PLATFORM', 'FUND_SVC_PROVIDER', 'OTHER']

function ClassificationsTab({ entity, canWrite, onRefresh }: { entity: EntityDetail; canWrite: boolean; onRefresh: () => void }) {
  const [adding,  setAdding]  = useState(false)
  const [newType, setNewType] = useState<EntityType>('VENDOR')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const existing = new Set(entity.classifications.map(c => c.type))

  async function addClassification() {
    setSaving(true); setError(null)
    try {
      const res = await apiClient(`/api/entities/${entity.id}/classifications`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: { message: string } }
        throw new Error(d.error?.message ?? `HTTP ${res.status}`)
      }
      setAdding(false); onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setSaving(false) }
  }

  async function removeClassification(id: string) {
    await apiClient(`/api/entities/${entity.id}/classifications/${id}`, { method: 'DELETE' })
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {entity.classifications.length === 0 && (
          <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--muted)' }}>No classifications set.</div>
        )}
        {entity.classifications.map((c, i) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: i < entity.classifications.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{TYPE_LABEL[c.type]}</span>
              {c.isPrimary && <Badge label="Primary" bg="#eff6ff" color="#2563eb" border="#2563eb22" />}
            </div>
            {canWrite && (
              <button onClick={() => removeClassification(c.id)}
                className="text-xs px-2 py-1 rounded-lg"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        adding ? (
          <div className="flex items-center gap-2">
            <select value={newType} onChange={e => setNewType(e.target.value as EntityType)}
              className="text-sm px-3 py-2 rounded-xl flex-1 outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
              {ALL_TYPES.filter(t => !existing.has(t)).map(t =>
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              )}
            </select>
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button onClick={addClassification} disabled={saving}
              className="text-sm px-3 py-2 rounded-xl disabled:opacity-50"
              style={{ background: '#2563eb', color: '#fff' }}>
              {saving ? '…' : 'Add'}
            </button>
            <button onClick={() => setAdding(false)}
              className="text-sm px-3 py-2 rounded-xl"
              style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Cancel
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="text-sm px-3 py-2 rounded-xl"
            style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
            + Add classification
          </button>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bank Accounts Tab
// ---------------------------------------------------------------------------
type BankForm = { label: string; accountName: string; accountNo: string; routingNo: string; swiftBic: string; iban: string; currency: string; paymentRail: PaymentRail }
const ALL_RAILS: PaymentRail[] = ['ACH', 'BACS', 'SWIFT', 'SEPA', 'WIRE', 'STRIPE', 'ERP', 'OTHER']
const RAIL_COLOR: Record<PaymentRail, string> = {
  ACH: '#2563eb', BACS: '#7c3aed', SWIFT: '#0891b2', SEPA: '#16a34a', WIRE: '#d97706', STRIPE: '#7c3aed', ERP: '#6b7280', OTHER: '#6b7280',
}

function BankAccountsTab({ entity, canWrite, onRefresh }: { entity: EntityDetail; canWrite: boolean; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState<BankForm>({ label: '', accountName: '', accountNo: '', routingNo: '', swiftBic: '', iban: '', currency: 'USD', paymentRail: 'ACH' })
  const [saving, setSaving]     = useState(false)
  const [error,  setError]      = useState<string | null>(null)

  function setF(k: keyof BankForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError(null)
    try {
      const res = await apiClient(`/api/entities/${entity.id}/bank-accounts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: { message: string } }
        throw new Error(d.error?.message ?? `HTTP ${res.status}`)
      }
      setShowForm(false); onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {entity.bankAccounts.length === 0 && (
          <div className="px-4 py-8 text-sm text-center" style={{ color: 'var(--muted)' }}>No bank accounts on file.</div>
        )}
        {entity.bankAccounts.map((ba, i) => (
          <div key={ba.id} className="px-4 py-3"
            style={{ borderBottom: i < entity.bankAccounts.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{ba.label}</span>
                {ba.isPrimary && <Badge label="Primary" bg="#eff6ff" color="#2563eb" border="#2563eb22" />}
              </div>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded font-medium"
                style={{ background: '#eff6ff', color: RAIL_COLOR[ba.paymentRail], border: '1px solid #2563eb22' }}>
                {ba.paymentRail}
              </span>
            </div>
            <div className="text-xs space-y-0.5" style={{ color: 'var(--muted)' }}>
              <div>{ba.accountName} · {ba.currency}</div>
              <div className="font-mono">{ba.accountNo}{ba.routingNo ? ` / ${ba.routingNo}` : ''}</div>
              {ba.iban    && <div className="font-mono">IBAN: {ba.iban}</div>}
              {ba.swiftBic && <div className="font-mono">BIC: {ba.swiftBic}</div>}
            </div>
          </div>
        ))}
      </div>

      {canWrite && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="text-sm px-3 py-2 rounded-xl"
          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          + Add bank account
        </button>
      )}

      {showForm && (
        <form onSubmit={save} className="rounded-2xl p-4 space-y-3"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <h4 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>New bank account</h4>
          <div className="grid grid-cols-2 gap-3">
            {([
              { k: 'label',       label: 'Label *',             required: true  },
              { k: 'accountName', label: 'Account name *',      required: true  },
              { k: 'accountNo',   label: 'Account number *',    required: true  },
              { k: 'routingNo',   label: 'Routing / Sort code', required: false },
              { k: 'swiftBic',    label: 'SWIFT / BIC',         required: false },
              { k: 'iban',        label: 'IBAN',                required: false },
            ] as { k: keyof BankForm; label: string; required: boolean }[]).map(({ k, label, required }) => (
              <div key={k}>
                <label style={labelStyle}>{label}</label>
                <input className={inputCls} style={inputStyle} required={required}
                  value={form[k]} onChange={setF(k)} />
              </div>
            ))}
            <div>
              <label style={labelStyle}>Currency</label>
              <select className={inputCls} style={inputStyle} value={form.currency} onChange={setF('currency')}>
                {['USD','GBP','EUR','CHF','JPY','CAD','AUD','SGD'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Payment rail</label>
              <select className={inputCls} style={inputStyle} value={form.paymentRail} onChange={setF('paymentRail')}>
                {ALL_RAILS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)}
              className="text-sm px-3 py-2 rounded-xl"
              style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="text-sm font-medium px-3 py-2 rounded-xl disabled:opacity-50"
              style={{ background: '#2563eb', color: '#fff' }}>
              {saving ? 'Saving…' : 'Save account'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Due Diligence Tab
// ---------------------------------------------------------------------------
const KYC_COLOR: Record<KycStatus | KybStatus, { bg: string; color: string; border: string; label: string }> = {
  NOT_REQUIRED: { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Not required' },
  PENDING:      { bg: '#eff6ff', color: '#2563eb', border: '#2563eb22', label: 'Pending'      },
  IN_REVIEW:    { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'In review'    },
  APPROVED:     { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Approved'     },
  FAILED:       { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Failed'       },
  EXPIRED:      { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Expired'      },
}
const SANCTIONS_COLOR: Record<SanctionsStatus, { bg: string; color: string; border: string; label: string }> = {
  CLEAR:        { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Clear'        },
  FLAGGED:      { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Flagged'      },
  UNDER_REVIEW: { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Under review' },
  BLOCKED:      { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Blocked'      },
}

function DueDiligenceTab({ entity }: { entity: EntityDetail }) {
  const dd = entity.dueDiligence
  if (!dd) return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>No due diligence record found.</div>

  function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div className="flex items-start justify-between py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-sm" style={{ color: 'var(--muted)' }}>{label}</span>
        <div className="text-sm font-medium text-right" style={{ color: 'var(--ink)' }}>{value}</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 space-y-0" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <Row label="DD level"        value={`Level ${dd.ddLevel}`} />
        <Row label="KYC status"      value={<Badge {...KYC_COLOR[dd.kycStatus]} />} />
        <Row label="KYB status"      value={<Badge {...KYC_COLOR[dd.kybStatus]} />} />
        <Row label="Sanctions"       value={<Badge {...SANCTIONS_COLOR[dd.sanctionsStatus]} />} />
        <Row label="PEP flag"        value={dd.pepStatus ? <Badge label="PEP flagged" bg="#fef2f2" color="#dc2626" border="#dc262622" /> : <span style={{ color: 'var(--muted)' }}>None</span>} />
        <Row label="Last reviewed"   value={fmt(dd.reviewedAt)} />
        <Row label="Next review due" value={fmt(dd.nextReviewDate)} />
      </div>
      {Object.entries(dd.internalFactors).length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--ink)' }}>Internal factors</h4>
          {Object.entries(dd.internalFactors).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span style={{ color: 'var(--muted)' }}>{k}</span>
              <span style={{ color: 'var(--ink)' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
      {Object.entries(dd.externalFactors).length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--ink)' }}>External factors</h4>
          {Object.entries(dd.externalFactors).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span style={{ color: 'var(--muted)' }}>{k}</span>
              <span style={{ color: 'var(--ink)' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Services Tab
// ---------------------------------------------------------------------------
const SLA_COLOR: Record<SlaStatus, { bg: string; color: string; border: string; label: string }> = {
  ON_TRACK:       { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'On track'  },
  AT_RISK:        { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'At risk'    },
  BREACHED:       { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Breached'   },
  NOT_APPLICABLE: { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'N/A'        },
}

function ServicesTab({ entity }: { entity: EntityDetail }) {
  if (entity.serviceEngagements.length === 0)
    return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>No service engagements.</div>
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {entity.serviceEngagements.map((se, i) => (
        <div key={se.id} className="px-4 py-3"
          style={{ borderBottom: i < entity.serviceEngagements.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-1">
            <div>
              <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{se.serviceCatalogue.name}</span>
            </div>
            <Badge {...SLA_COLOR[se.slaStatus]} />
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {fmt(se.contractStart)} → {fmt(se.contractEnd)} · Status: {se.status}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity Tab — full history
// ---------------------------------------------------------------------------
const ACTIVITY_ICON: Record<ActivityType, string> = {
  ONBOARDING: '◎', REVIEW: '◈', PAYMENT: '◉', STATUS_CHANGE: '◆',
  INCIDENT: '!', DOCUMENT: '◧', NOTE: '◌', EXTERNAL_SIGNAL: '◑', RISK_SCORE_CHANGE: '▲',
}
const ACTIVITY_COLOR: Record<ActivityType, string> = {
  ONBOARDING: '#2563eb', REVIEW: '#7c3aed', PAYMENT: '#16a34a', STATUS_CHANGE: '#d97706',
  INCIDENT: '#dc2626', DOCUMENT: '#0891b2', NOTE: '#6b7280', EXTERNAL_SIGNAL: '#ea580c', RISK_SCORE_CHANGE: '#7c3aed',
}

function ActivityTab({ entity }: { entity: EntityDetail }) {
  if (entity.entityActivityLogs.length === 0)
    return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>No activity recorded yet.</div>

  // Group by date
  const groups: Record<string, ActivityLog[]> = {}
  for (const log of entity.entityActivityLogs) {
    const day = new Date(log.occurredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    if (!groups[day]) groups[day] = []
    groups[day].push(log)
  }

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([day, logs]) => (
        <div key={day}>
          <div className="text-xs font-semibold mb-3 px-1" style={{ color: 'var(--muted)' }}>{day}</div>
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex gap-3 px-4 py-3 rounded-xl"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="text-sm mt-0.5 flex-shrink-0" style={{ color: ACTIVITY_COLOR[log.activityType] ?? '#6b7280' }}>
                  {ACTIVITY_ICON[log.activityType] ?? '·'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{log.title}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>
                      {new Date(log.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  {log.description && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{log.description}</div>
                  )}
                  {log.performedBy && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>by {log.performedBy}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
        Showing {entity.entityActivityLogs.length} most recent events
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Risk History Tab
// ---------------------------------------------------------------------------
function SmallBandBadge({ band }: { band: RiskBand | null }) {
  if (!band) return <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
  const s = RISK_BAND_STYLE[band]
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {band}
    </span>
  )
}

function RiskHistoryTab({ entityId }: { entityId: string }) {
  const [history, setHistory] = useState<RiskHistoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/entities/${entityId}/risk-history`)
      .then(r => r.json())
      .then((d: { history: RiskHistoryRecord[]; error?: { message: string } }) => {
        if (d.error) throw new Error(d.error.message)
        setHistory(d.history ?? [])
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [entityId])

  if (loading) return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="py-10 text-sm text-center text-red-600">{error}</div>
  if (history.length === 0)
    return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>No risk score history yet.</div>

  const th = 'px-4 py-2 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-4 py-3 text-sm'

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full">
        <thead style={{ background: 'var(--surface)' }}>
          <tr>
            {['Date', 'Band', 'Score'].map(h => (
              <th key={h} className={th}
                style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((row, i) => {
            const prevBand = i + 1 < history.length ? history[i + 1].band : null
            const bandChanged = row.band !== prevBand && i > 0 ? true : false
            const score = row.score ?? row.computedScore
            return (
              <tr key={row.id}
                style={{
                  borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                  background: bandChanged ? 'var(--surface)' : 'transparent',
                }}>
                <td className={td} style={{ color: 'var(--muted)' }}>
                  {row.computedAt ? fmt(row.computedAt) : '—'}
                </td>
                <td className={td}>
                  <SmallBandBadge band={row.band} />
                </td>
                <td className={td} style={{ color: 'var(--ink)' }}>
                  <span className="tabular-nums font-mono text-xs">{score.toFixed(1)}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',        label: 'Overview'        },
  { key: 'classifications', label: 'Classifications' },
  { key: 'bank-accounts',   label: 'Bank Accounts'   },
  { key: 'due-diligence',   label: 'Due Diligence'   },
  { key: 'services',        label: 'Services'        },
  { key: 'activity',        label: 'History'         },
  { key: 'risk-history',    label: 'Risk History'    },
  { key: 'workflow',        label: 'Workflow'        },
]

export default function EntityDetailPage() {
  const { role } = useUser()
  const router   = useRouter()
  const params   = useParams()
  const entityId = params.entityId as string

  const [entity,  setEntity]  = useState<EntityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tab,     setTab]     = useState<TabKey>('overview')

  const { data: workflowData } = useQuery({
    queryKey: queryKeys.entities.workflow(entityId),
    enabled:  !!entityId && ALLOWED_ROLES.has(role ?? ''),
    queryFn:  async () => {
      const res = await fetch(`/api/entities/${entityId}/workflow`)
      if (!res.ok) return { workflow: null as WorkflowState | null, history: [] as WorkflowHistoryEntry[] }
      return res.json() as Promise<{ workflow: WorkflowState | null; history?: WorkflowHistoryEntry[] }>
    },
  })

  const canWrite    = WRITE_ROLES.has(role ?? '')
  const canOverride = OVERRIDE_ROLES.has(role ?? '')

  const fetchEntity = useCallback(() => {
    setLoading(true)
    fetch(`/api/entities/${entityId}`)
      .then(r => r.json())
      .then((d: { entity: EntityDetail; error?: { message: string } }) => {
        if (d.error) throw new Error(d.error.message)
        setEntity(d.entity)
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [entityId])

  useEffect(() => {
    if (!ALLOWED_ROLES.has(role ?? '')) { router.replace('/dashboard'); return }
    fetchEntity()
  }, [role, router, fetchEntity])

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>
  if (!entity) return null

  return (
    <div className="p-8 max-w-4xl space-y-6">

      {/* Header */}
      <div>
        <button onClick={() => router.push('/dashboard/entities')}
          className="text-xs mb-3 inline-flex items-center gap-1"
          style={{ color: 'var(--muted)' }}>
          ← Entities
        </button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>{entity.name}</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {entity.jurisdiction ?? ''}{entity.jurisdiction ? ' · ' : ''}{entity.legalStructure.charAt(0) + entity.legalStructure.slice(1).toLowerCase()}
              {entity.stockTicker && (
                <span className="ml-2 px-2 py-0.5 rounded font-mono text-xs"
                  style={{ background: '#f1f5f9', color: '#475569' }}>
                  {entity.stockTicker}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ONBOARDING_ROLES.has(role ?? '') && (
              <button onClick={() => router.push(`/dashboard/entities/${entityId}/onboarding`)}
                className="text-sm font-medium px-4 py-2 rounded-xl"
                style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
                Onboarding
              </button>
            )}
            {/* Risk band display in header */}
            <div className="flex flex-col items-end gap-0.5">
              <RiskBandBadge band={entity.riskBand} />
              <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                Score {entity.riskScore.toFixed(1)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1">
        {TABS.map(t => {
          const active = tab === t.key
          const isHistory = t.key === 'activity' && entity.entityActivityLogs.length > 0
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: active ? '#2563eb' : 'var(--surface)',
                color:      active ? '#fff'    : 'var(--muted)',
                border:     active ? '1px solid #2563eb' : '1px solid var(--border)',
              }}>
              {t.label}
              {isHistory && !active && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                  style={{ background: '#f1f5f9', color: '#475569' }}>
                  {entity.entityActivityLogs.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'overview'        && <OverviewTab        entity={entity} canWrite={canWrite} canOverride={canOverride} onRefresh={fetchEntity} />}
      {tab === 'classifications' && <ClassificationsTab entity={entity} canWrite={canWrite} onRefresh={fetchEntity} />}
      {tab === 'bank-accounts'   && <BankAccountsTab    entity={entity} canWrite={canWrite} onRefresh={fetchEntity} />}
      {tab === 'due-diligence'   && <DueDiligenceTab    entity={entity} />}
      {tab === 'services'        && <ServicesTab        entity={entity} />}
      {tab === 'activity'        && <ActivityTab        entity={entity} />}
      {tab === 'risk-history'    && <RiskHistoryTab     entityId={entityId} />}
      {tab === 'workflow'        && (
        <div className="max-w-2xl">
          <WorkflowPanel workflow={workflowData?.workflow ?? null} history={workflowData?.history} />
        </div>
      )}
    </div>
  )
}
