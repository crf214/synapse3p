'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH'

const TIER_COLOR: Record<RiskTier, { bg: string; text: string }> = {
  LOW:    { bg: '#f0fdf4', text: '#16a34a' },
  MEDIUM: { bg: '#fff7ed', text: '#ea580c' },
  HIGH:   { bg: '#fef2f2', text: '#dc2626' },
}

interface AutoApprovePolicy {
  id:                    string
  name:                  string
  isActive:              boolean
  entityId:              string | null
  entity:                { id: string; name: string } | null
  maxAmount:             number | null
  currency:              string
  requireContractMatch:  boolean
  requireRecurringMatch: boolean
  allowedRiskTiers:      RiskTier[]
  noDuplicateFlag:       boolean
  noAnomalyFlag:         boolean
  allFieldsExtracted:    boolean
  createdAt:             string
  updatedAt:             string
  creator:               { id: string; name: string | null; email: string } | null
  updater:               { id: string; name: string | null; email: string } | null
}

interface EntityOption { id: string; name: string }

// ── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  initial: AutoApprovePolicy | null
  entities: EntityOption[]
  onSave: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

function PolicyModal({ initial, entities, onSave, onClose }: ModalProps) {
  const isEdit = !!initial?.id

  const [name,          setName]          = useState(initial?.name      ?? '')
  const [entityId,      setEntityId]      = useState(initial?.entityId  ?? '')
  const [maxAmount,     setMaxAmount]     = useState(initial?.maxAmount != null ? String(initial.maxAmount) : '')
  const [currency,      setCurrency]      = useState(initial?.currency  ?? 'USD')
  const [tiers,         setTiers]         = useState<Set<RiskTier>>(new Set(initial?.allowedRiskTiers ?? []))
  const [contractMatch, setContractMatch] = useState(initial?.requireContractMatch  ?? true)
  const [recurringMatch,setRecurringMatch]= useState(initial?.requireRecurringMatch ?? false)
  const [noDup,         setNoDup]         = useState(initial?.noDuplicateFlag       ?? true)
  const [noAnomaly,     setNoAnomaly]     = useState(initial?.noAnomalyFlag         ?? true)
  const [allFields,     setAllFields]     = useState(initial?.allFieldsExtracted    ?? false)
  const [isActive,      setIsActive]      = useState(initial?.isActive              ?? true)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  function toggleTier(t: RiskTier) {
    setTiers(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name,
        entityId:              entityId || null,
        maxAmount:             maxAmount ? Number(maxAmount) : null,
        currency,
        allowedRiskTiers:      [...tiers],
        requireContractMatch:  contractMatch,
        requireRecurringMatch: recurringMatch,
        noDuplicateFlag:       noDup,
        noAnomalyFlag:         noAnomaly,
        allFieldsExtracted:    allFields,
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
            {isEdit ? 'Edit Policy' : 'New Auto-Approve Policy'}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Invoices matching all enabled criteria will be auto-approved without human review.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
              Policy Name <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required
              placeholder="e.g. Low-value trusted vendor"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>

          {/* Scope */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
              Scope
            </label>
            <select value={entityId} onChange={e => setEntityId(e.target.value)}
              disabled={isEdit}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none disabled:opacity-60"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
              <option value="">Org-wide default</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {isEdit && (
              <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Scope cannot be changed after creation.</p>
            )}
          </div>

          {/* Amount ceiling */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
              Maximum Amount (leave blank for no limit)
            </label>
            <div className="flex gap-2">
              <input type="number" min="0" step="0.01" value={maxAmount} onChange={e => setMaxAmount(e.target.value)}
                placeholder="e.g. 5000"
                className="flex-1 px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                {['USD','EUR','GBP','CAD','AUD','CHF','JPY','SGD'].map(c =>
                  <option key={c} value={c}>{c}</option>
                )}
              </select>
            </div>
          </div>

          {/* Allowed risk tiers */}
          <div>
            <label className="text-xs font-medium block mb-2" style={{ color: 'var(--muted)' }}>
              Allowed Risk Tiers (invoice must be in one of these tiers)
            </label>
            <div className="flex gap-2">
              {(['LOW', 'MEDIUM', 'HIGH'] as RiskTier[]).map(t => {
                const active = tiers.has(t)
                const col    = TIER_COLOR[t]
                return (
                  <button key={t} type="button" onClick={() => toggleTier(t)}
                    className="flex-1 py-2 rounded-xl text-xs font-medium transition-all"
                    style={{
                      border:     active ? `2px solid ${col.text}` : '1px solid var(--border)',
                      background: active ? col.bg : 'var(--surface)',
                      color:      active ? col.text : 'var(--muted)',
                    }}>
                    {t}
                  </button>
                )
              })}
            </div>
            {tiers.size === 0 && (
              <p className="text-xs mt-1" style={{ color: '#ea580c' }}>
                No tiers selected — risk tier will not be checked.
              </p>
            )}
          </div>

          {/* Boolean conditions */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Required conditions</p>
            {[
              { label: 'Require contract match',          desc: 'Invoice must match a valid contract.',              val: contractMatch,  set: setContractMatch },
              { label: 'Accept recurring schedule match', desc: 'A matching recurring schedule satisfies contract.', val: recurringMatch, set: setRecurringMatch },
              { label: 'No duplicate flag',               desc: 'Invoice must not be flagged as a potential duplicate.', val: noDup,      set: setNoDup },
              { label: 'No anomaly flag',                 desc: 'Invoice must not have an anomaly risk flag.',       val: noAnomaly,      set: setNoAnomaly },
              { label: 'All fields extracted',            desc: 'All required fields must meet confidence threshold.', val: allFields,   set: setAllFields },
            ].map(({ label, desc, val, set }) => (
              <label key={label} className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                  className="mt-0.5 flex-shrink-0" style={{ accentColor: '#2563eb' }} />
                <div>
                  <p className="text-sm" style={{ color: 'var(--ink)' }}>{label}</p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Active toggle (edit only) */}
          {isEdit && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                style={{ accentColor: '#2563eb' }} />
              <span className="text-sm" style={{ color: 'var(--ink)' }}>Policy is active</span>
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
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function AutoApprovePoliciesPage() {
  const user = useUser()

  const [policies,  setPolicies]  = useState<AutoApprovePolicy[]>([])
  const [entities,  setEntities]  = useState<EntityOption[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [modal,     setModal]     = useState<'new' | AutoApprovePolicy | null>(null)
  const [toDelete,  setToDelete]  = useState<AutoApprovePolicy | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const isAdmin = user.role === 'ADMIN'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [polRes, entRes] = await Promise.all([
        fetch('/api/auto-approve-policies'),
        fetch('/api/entities?pageSize=200'),
      ])
      if (!polRes.ok) throw new Error()
      const polData = await polRes.json()
      setPolicies(polData.policies)
      if (entRes.ok) {
        const entData = await entRes.json()
        setEntities(entData.entities ?? entData.data ?? [])
      }
    } catch {
      setError('Could not load policies.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  async function handleSave(data: Record<string, unknown>) {
    const editing = modal !== 'new' && modal !== null
    const res = await apiClient(
      editing ? `/api/auto-approve-policies/${(modal as AutoApprovePolicy).id}` : '/api/auto-approve-policies',
      {
        method:  editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      }
    )
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error?.message ?? 'Save failed')
    }
    setModal(null)
    await load()
  }

  async function handleToggle(policy: AutoApprovePolicy) {
    await apiClient(`/api/auto-approve-policies/${policy.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isActive: !policy.isActive }),
    })
    await load()
  }

  async function handleDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await apiClient(`/api/auto-approve-policies/${toDelete.id}`, { method: 'DELETE' })
      setToDelete(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  function fmtAmt(v: number, cur: string) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v)
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const orgDefault    = policies.find(p => !p.entityId)
  const entityPolicies = policies.filter(p => p.entityId)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Auto-Approve Policies</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Invoices meeting all policy criteria are automatically approved without manual review.
            Entity-level policies override the org-wide default.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setModal('new')}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Policy
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 mb-2 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : policies.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No policies configured</p>
          <p className="text-sm">All invoices will require manual approval.</p>
          {isAdmin && (
            <button onClick={() => setModal('new')}
              className="text-sm mt-3 inline-block" style={{ color: '#2563eb' }}>
              Create an org-wide default →
            </button>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-8">

          {/* Org-wide default */}
          <section>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--muted)' }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#2563eb' }} />
              Org-Wide Default
            </h2>
            {orgDefault ? (
              <PolicyCard
                policy={orgDefault}
                isAdmin={isAdmin}
                fmtAmt={fmtAmt}
                fmtDate={fmtDate}
                onEdit={() => setModal(orgDefault)}
                onToggle={() => handleToggle(orgDefault)}
                onDelete={() => setToDelete(orgDefault)}
              />
            ) : (
              <div className="rounded-2xl px-5 py-4 text-sm"
                style={{ border: '1px dashed var(--border)', color: 'var(--muted)' }}>
                No org-wide default — all invoices require manual approval unless an entity policy applies.
                {isAdmin && (
                  <button onClick={() => setModal('new')} className="ml-2 hover:underline" style={{ color: '#2563eb' }}>
                    Create default
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Entity overrides */}
          {entityPolicies.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#9333ea' }} />
                Entity Overrides ({entityPolicies.length})
              </h2>
              <div className="space-y-3">
                {entityPolicies.map(p => (
                  <PolicyCard
                    key={p.id}
                    policy={p}
                    isAdmin={isAdmin}
                    fmtAmt={fmtAmt}
                    fmtDate={fmtDate}
                    onEdit={() => setModal(p)}
                    onToggle={() => handleToggle(p)}
                    onDelete={() => setToDelete(p)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Modal */}
      {modal !== null && (
        <PolicyModal
          initial={modal === 'new' ? null : modal}
          entities={entities}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirmation */}
      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Delete Policy</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
              Delete <strong>{toDelete.name}</strong>?
              {!toDelete.entityId && ' Invoices will require manual approval until a new default is created.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setToDelete(null)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Cancel
              </button>
              <button disabled={deleting} onClick={handleDelete}
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

// ── Policy card sub-component ─────────────────────────────────────────────────

interface CardProps {
  policy:    AutoApprovePolicy
  isAdmin:   boolean
  fmtAmt:    (v: number, cur: string) => string
  fmtDate:   (iso: string) => string
  onEdit:    () => void
  onToggle:  () => void
  onDelete:  () => void
}

function PolicyCard({ policy, isAdmin, fmtAmt, fmtDate, onEdit, onToggle, onDelete }: CardProps) {
  const checks = [
    { label: 'Contract match required',    active: policy.requireContractMatch },
    { label: 'Recurring match accepted',   active: policy.requireRecurringMatch },
    { label: 'No duplicate flag',          active: policy.noDuplicateFlag },
    { label: 'No anomaly flag',            active: policy.noAnomalyFlag },
    { label: 'All fields extracted',       active: policy.allFieldsExtracted },
  ]

  return (
    <div className="rounded-2xl p-5"
      style={{
        border:     `1px solid ${policy.isActive ? 'var(--border)' : '#e2e8f0'}`,
        background: policy.isActive ? '#fff' : '#f8fafc',
        opacity:    policy.isActive ? 1 : 0.75,
      }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="font-medium text-sm" style={{ color: 'var(--ink)' }}>{policy.name}</span>
            {policy.entity && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: '#fdf4ff', color: '#9333ea' }}>
                {policy.entity.name}
              </span>
            )}
            {!policy.isActive && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: '#f1f5f9', color: '#94a3b8' }}>Inactive</span>
            )}
          </div>

          {/* Amount ceiling */}
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: '#f1f5f9', color: '#475569' }}>
              {policy.maxAmount != null
                ? `≤ ${fmtAmt(policy.maxAmount, policy.currency)}`
                : 'No amount limit'}
            </span>
            {policy.allowedRiskTiers.length > 0
              ? policy.allowedRiskTiers.map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: TIER_COLOR[t].bg, color: TIER_COLOR[t].text }}>
                    {t}
                  </span>
                ))
              : (
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: '#f8fafc', color: '#94a3b8' }}>Any risk tier</span>
              )
            }
          </div>

          {/* Condition checklist */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {checks.map(({ label, active }) => (
              <span key={label} className="text-xs flex items-center gap-1"
                style={{ color: active ? '#16a34a' : '#94a3b8' }}>
                <span>{active ? '✓' : '○'}</span> {label}
              </span>
            ))}
          </div>

          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            Updated {fmtDate(policy.updatedAt)}
            {policy.updater && ` by ${policy.updater.name ?? policy.updater.email}`}
          </p>
        </div>

        {isAdmin && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={onToggle}
              className="px-3 py-1.5 rounded-xl text-xs"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
              {policy.isActive ? 'Disable' : 'Enable'}
            </button>
            <button onClick={onEdit}
              className="px-3 py-1.5 rounded-xl text-xs font-medium"
              style={{ border: '1px solid #2563eb22', background: '#eff6ff', color: '#2563eb' }}>
              Edit
            </button>
            <button onClick={onDelete}
              className="px-3 py-1.5 rounded-xl text-xs"
              style={{ border: '1px solid #fecaca', color: '#dc2626' }}>
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
