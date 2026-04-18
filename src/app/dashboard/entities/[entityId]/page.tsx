'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EntityStatus     = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW' | 'OFFBOARDED'
type EntityType       = 'VENDOR' | 'CONTRACTOR' | 'PARTNER' | 'COUNTERPARTY' | 'SERVICE_PROVIDER' | 'BROKER' | 'PLATFORM' | 'FUND_SERVICE' | 'OTHER'
type KycStatus        = 'NOT_REQUIRED' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'FAILED' | 'EXPIRED'
type KybStatus        = 'NOT_REQUIRED' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'FAILED' | 'EXPIRED'
type SanctionsStatus  = 'CLEAR' | 'FLAGGED' | 'UNDER_REVIEW' | 'BLOCKED'
type SlaStatus        = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'NOT_APPLICABLE'
type ActivityType     = 'ONBOARDING' | 'REVIEW' | 'PAYMENT' | 'STATUS_CHANGE' | 'INCIDENT' | 'DOCUMENT' | 'NOTE' | 'EXTERNAL_SIGNAL' | 'RISK_SCORE_CHANGE'
type PaymentRail      = 'ACH' | 'BACS' | 'SWIFT' | 'SEPA' | 'WIRE' | 'STRIPE' | 'ERP' | 'OTHER'

interface Classification { id: string; type: EntityType; isPrimary: boolean; startDate: string | null; notes: string | null }
interface BankAccount    { id: string; label: string; accountName: string; accountNo: string; routingNo: string | null; swiftBic: string | null; iban: string | null; currency: string; paymentRail: PaymentRail; isPrimary: boolean; status: string }
interface DueDiligence   { ddLevel: number; kycStatus: KycStatus; kybStatus: KybStatus; sanctionsStatus: SanctionsStatus; pepStatus: boolean; nextReviewDate: string | null; reviewedAt: string | null; internalFactors: Record<string, unknown>; externalFactors: Record<string, unknown> }
interface RiskScore      { computedScore: number; ddScore: number; behaviorScore: number; sanctionsScore: number; paymentHistoryScore: number; weights: Record<string, number>; scoredAt: string; notes: string | null }
interface OrgRelationship { onboardingStatus: string; activeForBillPay: boolean; portalAccess: boolean; approvedSpendLimit: number | null; contractStart: string | null; contractEnd: string | null }
interface ServiceEngagement { id: string; status: string; contractStart: string | null; contractEnd: string | null; slaStatus: SlaStatus; serviceCatalogue: { name: string; category: string } }
interface ActivityLog    { id: string; activityType: ActivityType; title: string; description: string | null; performedBy: string | null; occurredAt: string }
interface EntityDetail {
  id: string; name: string; slug: string; status: EntityStatus; legalStructure: string
  jurisdiction: string | null; registrationNo: string | null; incorporationDate: string | null
  primaryCurrency: string; riskScore: number; riskOverride: boolean
  parent: { id: string; name: string; slug: string } | null
  classifications:    Classification[]
  bankAccounts:       BankAccount[]
  dueDiligence:       DueDiligence | null
  riskScores:         RiskScore[]
  orgRelationships:   OrgRelationship[]
  serviceEngagements: ServiceEngagement[]
  entityActivityLogs: ActivityLog[]
}

type TabKey = 'overview' | 'classifications' | 'bank-accounts' | 'due-diligence' | 'services' | 'activity'

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
  return `${days}d ago`
}

function riskColor(score: number): { bg: string; color: string; border: string } {
  if (score >= 7) return { bg: '#fef2f2', color: '#dc2626', border: '#dc262622' }
  if (score >= 4) return { bg: '#fffbeb', color: '#d97706', border: '#d9770622' }
  return              { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22' }
}

function Badge({ label, bg, color, border }: { label: string; bg: string; color: string; border: string }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color, border: `1px solid ${border}` }}>
      {label}
    </span>
  )
}

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

const SLA_COLOR: Record<SlaStatus, { bg: string; color: string; border: string; label: string }> = {
  ON_TRACK:       { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'On track'       },
  AT_RISK:        { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'At risk'         },
  BREACHED:       { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Breached'        },
  NOT_APPLICABLE: { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'N/A'             },
}

const TYPE_LABEL: Record<EntityType, string> = {
  VENDOR: 'Vendor', CONTRACTOR: 'Contractor', PARTNER: 'Partner', COUNTERPARTY: 'Counterparty',
  SERVICE_PROVIDER: 'Service Provider', BROKER: 'Broker', PLATFORM: 'Platform',
  FUND_SERVICE: 'Fund Service', OTHER: 'Other',
}

const ALL_TYPES: EntityType[] = ['VENDOR', 'CONTRACTOR', 'PARTNER', 'COUNTERPARTY', 'SERVICE_PROVIDER', 'BROKER', 'PLATFORM', 'FUND_SERVICE', 'OTHER']
const ALL_RAILS: PaymentRail[] = ['ACH', 'BACS', 'SWIFT', 'SEPA', 'WIRE', 'STRIPE', 'ERP', 'OTHER']

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------
function OverviewTab({ entity }: { entity: EntityDetail }) {
  const rc = riskColor(entity.riskScore)
  const latestRisk = entity.riskScores[0] ?? null

  function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div className="flex items-start justify-between py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-sm" style={{ color: 'var(--muted)' }}>{label}</span>
        <span className="text-sm font-medium text-right max-w-[60%]" style={{ color: 'var(--ink)' }}>{value}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5 space-y-0" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <Row label="Legal name"          value={entity.name} />
        <Row label="Legal structure"     value={entity.legalStructure.charAt(0) + entity.legalStructure.slice(1).toLowerCase()} />
        <Row label="Jurisdiction"        value={entity.jurisdiction ?? '—'} />
        <Row label="Registration No."    value={entity.registrationNo ?? '—'} />
        <Row label="Incorporation date"  value={fmt(entity.incorporationDate)} />
        <Row label="Primary currency"    value={entity.primaryCurrency} />
        <Row label="Status"              value={entity.status} />
        {entity.parent && (
          <Row label="Parent entity" value={entity.parent.name} />
        )}
      </div>

      {/* Risk score card */}
      <div className="rounded-2xl p-5 space-y-4" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Risk score</h3>
          <span className="text-2xl font-display tabular-nums px-3 py-1 rounded-xl"
            style={{ background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
            {entity.riskScore.toFixed(1)}
          </span>
        </div>
        {latestRisk && (
          <div className="space-y-2">
            {[
              { label: 'Due diligence',    score: latestRisk.ddScore,           weight: latestRisk.weights['dd']        },
              { label: 'Behavior',         score: latestRisk.behaviorScore,     weight: latestRisk.weights['behavior']  },
              { label: 'Sanctions',        score: latestRisk.sanctionsScore,    weight: latestRisk.weights['sanctions'] },
              { label: 'Payment history',  score: latestRisk.paymentHistoryScore, weight: null                         },
            ].map(({ label, score, weight }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs w-28" style={{ color: 'var(--muted)' }}>{label}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(score / 10) * 100}%`, background: '#2563eb' }} />
                </div>
                <span className="text-xs tabular-nums w-8 text-right" style={{ color: 'var(--ink)' }}>{score.toFixed(1)}</span>
                {weight != null && (
                  <span className="text-xs w-8 text-right" style={{ color: 'var(--muted)' }}>{(weight * 100).toFixed(0)}%</span>
                )}
              </div>
            ))}
            <p className="text-xs pt-1" style={{ color: 'var(--muted)' }}>Scored {relativeTime(latestRisk.scoredAt)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Classifications Tab
// ---------------------------------------------------------------------------
function ClassificationsTab({ entity, canWrite, onRefresh }: { entity: EntityDetail; canWrite: boolean; onRefresh: () => void }) {
  const [adding,  setAdding]  = useState(false)
  const [newType, setNewType] = useState<EntityType>('SERVICE_PROVIDER')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const existing = new Set(entity.classifications.map(c => c.type))

  async function addClassification() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/entities/${entity.id}/classifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setAdding(false); onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function removeClassification(id: string) {
    await fetch(`/api/entities/${entity.id}/classifications/${id}`, { method: 'DELETE' })
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
interface BankForm { label: string; accountName: string; accountNo: string; routingNo: string; swiftBic: string; iban: string; currency: string; paymentRail: PaymentRail }

function BankAccountsTab({ entity, canWrite, onRefresh }: { entity: EntityDetail; canWrite: boolean; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState<BankForm>({ label: '', accountName: '', accountNo: '', routingNo: '', swiftBic: '', iban: '', currency: 'USD', paymentRail: 'ACH' })
  const [saving, setSaving]     = useState(false)
  const [error,  setError]      = useState<string | null>(null)

  function setF(k: keyof BankForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }))
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/entities/${entity.id}/bank-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      setShowForm(false); onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full text-sm px-3 py-2 rounded-lg outline-none'
  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }
  const labelCls = 'block text-xs font-medium mb-1'

  const RAIL_COLOR: Record<PaymentRail, string> = {
    ACH: '#2563eb', BACS: '#7c3aed', SWIFT: '#0891b2', SEPA: '#16a34a', WIRE: '#d97706', STRIPE: '#7c3aed', ERP: '#6b7280', OTHER: '#6b7280',
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
              {ba.iban && <div className="font-mono">IBAN: {ba.iban}</div>}
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
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Label *</label>
              <input className={inputCls} style={inputStyle} required value={form.label} onChange={setF('label')} placeholder="e.g. Primary USD" />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Account name *</label>
              <input className={inputCls} style={inputStyle} required value={form.accountName} onChange={setF('accountName')} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Account number *</label>
              <input className={inputCls} style={inputStyle} required value={form.accountNo} onChange={setF('accountNo')} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Routing / Sort code</label>
              <input className={inputCls} style={inputStyle} value={form.routingNo} onChange={setF('routingNo')} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>SWIFT / BIC</label>
              <input className={inputCls} style={inputStyle} value={form.swiftBic} onChange={setF('swiftBic')} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>IBAN</label>
              <input className={inputCls} style={inputStyle} value={form.iban} onChange={setF('iban')} />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Currency</label>
              <select className={inputCls} style={inputStyle} value={form.currency} onChange={setF('currency')}>
                {['USD','GBP','EUR','CHF','JPY','CAD','AUD','SGD'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--muted)' }}>Payment rail</label>
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
function DueDiligenceTab({ entity }: { entity: EntityDetail }) {
  const dd = entity.dueDiligence
  if (!dd) {
    return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>No due diligence record found.</div>
  }

  const kyc = KYC_COLOR[dd.kycStatus]
  const kyb = KYC_COLOR[dd.kybStatus]
  const sanc = SANCTIONS_COLOR[dd.sanctionsStatus]

  function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
      <div className="flex items-start justify-between py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <span className="text-sm" style={{ color: 'var(--muted)' }}>{label}</span>
        <div className="text-sm font-medium text-right" style={{ color: 'var(--ink)' }}>{value}</div>
      </div>
    )
  }

  const factorKeys = (obj: Record<string, unknown>) => Object.entries(obj)

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 space-y-0" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <Row label="DD level"        value={`Level ${dd.ddLevel}`} />
        <Row label="KYC status"      value={<Badge {...kyc} />} />
        <Row label="KYB status"      value={<Badge {...kyb} />} />
        <Row label="Sanctions"       value={<Badge {...sanc} />} />
        <Row label="PEP flag"        value={dd.pepStatus ? <Badge label="PEP flagged" bg="#fef2f2" color="#dc2626" border="#dc262622" /> : <span style={{ color: 'var(--muted)' }}>None</span>} />
        <Row label="Last reviewed"   value={fmt(dd.reviewedAt)} />
        <Row label="Next review due" value={fmt(dd.nextReviewDate)} />
      </div>

      {factorKeys(dd.internalFactors).length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--ink)' }}>Internal factors</h4>
          {factorKeys(dd.internalFactors).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span style={{ color: 'var(--muted)' }}>{k}</span>
              <span style={{ color: 'var(--ink)' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {factorKeys(dd.externalFactors).length > 0 && (
        <div className="rounded-2xl p-4 space-y-2" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--ink)' }}>External factors</h4>
          {factorKeys(dd.externalFactors).map(([k, v]) => (
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
function ServicesTab({ entity }: { entity: EntityDetail }) {
  if (entity.serviceEngagements.length === 0) {
    return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>No service engagements.</div>
  }
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {entity.serviceEngagements.map((se, i) => {
        const sla = SLA_COLOR[se.slaStatus]
        return (
          <div key={se.id} className="px-4 py-3"
            style={{ borderBottom: i < entity.serviceEngagements.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
            <div className="flex items-center justify-between mb-1">
              <div>
                <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{se.serviceCatalogue.name}</span>
                <span className="text-xs ml-2 px-1.5 py-0.5 rounded font-mono"
                  style={{ background: 'var(--border)', color: 'var(--muted)' }}>
                  {se.serviceCatalogue.category}
                </span>
              </div>
              <Badge {...sla} />
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              {fmt(se.contractStart)} → {fmt(se.contractEnd)} · Status: {se.status}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Activity Tab
// ---------------------------------------------------------------------------
function ActivityTab({ entity }: { entity: EntityDetail }) {
  const TYPE_ICON: Record<ActivityType, string> = {
    ONBOARDING: '◎', REVIEW: '◈', PAYMENT: '◉', STATUS_CHANGE: '◆',
    INCIDENT: '!', DOCUMENT: '◧', NOTE: '◌', EXTERNAL_SIGNAL: '◑', RISK_SCORE_CHANGE: '▲',
  }

  if (entity.entityActivityLogs.length === 0) {
    return <div className="py-10 text-sm text-center" style={{ color: 'var(--muted)' }}>No activity recorded.</div>
  }

  return (
    <div className="space-y-2">
      {entity.entityActivityLogs.map(log => (
        <div key={log.id} className="flex gap-3 px-4 py-3 rounded-xl"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <span className="text-base mt-0.5 flex-shrink-0" style={{ color: 'var(--muted)' }}>
            {TYPE_ICON[log.activityType] ?? '·'}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{log.title}</div>
            {log.description && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{log.description}</div>
            )}
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {relativeTime(log.occurredAt)}
              {log.performedBy && ` · by ${log.performedBy}`}
            </div>
          </div>
        </div>
      ))}
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
  { key: 'activity',        label: 'Activity'        },
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

  const canWrite = WRITE_ROLES.has(role ?? '')

  const fetchEntity = useCallback(() => {
    setLoading(true)
    fetch(`/api/entities/${entityId}`)
      .then(r => r.json())
      .then((d: { entity: EntityDetail; error?: string }) => {
        if (d.error) throw new Error(d.error)
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

  const rc = riskColor(entity.riskScore)

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
              {entity.jurisdiction ?? ''} · {entity.legalStructure.charAt(0) + entity.legalStructure.slice(1).toLowerCase()}
            </p>
          </div>
          <span className="text-lg font-display tabular-nums px-3 py-1.5 rounded-xl"
            style={{ background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
            {entity.riskScore.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1">
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: active ? '#2563eb' : 'var(--surface)',
                color:      active ? '#fff'    : 'var(--muted)',
                border:     active ? '1px solid #2563eb' : '1px solid var(--border)',
              }}>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'overview'        && <OverviewTab        entity={entity} />}
      {tab === 'classifications' && <ClassificationsTab entity={entity} canWrite={canWrite} onRefresh={fetchEntity} />}
      {tab === 'bank-accounts'   && <BankAccountsTab    entity={entity} canWrite={canWrite} onRefresh={fetchEntity} />}
      {tab === 'due-diligence'   && <DueDiligenceTab    entity={entity} />}
      {tab === 'services'        && <ServicesTab         entity={entity} />}
      {tab === 'activity'        && <ActivityTab         entity={entity} />}
    </div>
  )
}
