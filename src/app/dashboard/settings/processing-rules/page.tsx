'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

type Track = 'FULL_PO' | 'LIGHTWEIGHT' | 'STP' | 'CONTRACT_REQUIRED'

const TRACK_LABEL: Record<Track, string> = {
  FULL_PO:           'Full PO',
  LIGHTWEIGHT:       'Lightweight',
  STP:               'Straight-Through',
  CONTRACT_REQUIRED: 'Contract Required',
}

const TRACK_COLOR: Record<Track, { bg: string; text: string }> = {
  FULL_PO:           { bg: '#eff6ff', text: '#2563eb' },
  LIGHTWEIGHT:       { bg: '#f0fdf4', text: '#16a34a' },
  STP:               { bg: '#fdf4ff', text: '#9333ea' },
  CONTRACT_REQUIRED: { bg: '#fff7ed', text: '#ea580c' },
}

const TRACK_DESCRIPTION: Record<Track, string> = {
  FULL_PO:           'Requires a matching Purchase Order with full approval workflow.',
  LIGHTWEIGHT:       'Simplified approval — no PO required, lower scrutiny.',
  STP:               'Straight-through processing — auto-approved when conditions match.',
  CONTRACT_REQUIRED: 'A valid contract must be in place before the invoice is processed.',
}

// Condition field options for the UI builder
const CONDITION_FIELDS = [
  { value: 'amount',     label: 'Amount' },
  { value: 'currency',   label: 'Currency' },
  { value: 'entityId',   label: 'Entity ID' },
  { value: 'department', label: 'Department' },
  { value: 'category',   label: 'Category' },
]

const CONDITION_OPS = [
  { value: 'eq',  label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'gt',  label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt',  label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'in',  label: 'in list' },
]

interface ConditionRow { field: string; op: string; value: string }

interface ProcessingRule {
  id:                   string
  name:                 string
  description:          string | null
  priority:             number
  isActive:             boolean
  conditions:           unknown
  track:                Track
  requiresGoodsReceipt: boolean
  requiresContract:     boolean
  notes:                string | null
  createdAt:            string
  updatedAt:            string
  creator:              { id: string; name: string | null; email: string } | null
  updater:              { id: string; name: string | null; email: string } | null
}

// ── Condition builder helpers ────────────────────────────────────────────────

function conditionsToRows(raw: unknown): ConditionRow[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { rules?: unknown }).rules)) return []
  return ((raw as { rules: unknown[] }).rules).map((r: unknown) => {
    const rule = r as { field?: string; op?: string; value?: unknown }
    return {
      field: rule.field ?? 'amount',
      op:    rule.op    ?? 'gte',
      value: String(rule.value ?? ''),
    }
  })
}

function rowsToConditions(rows: ConditionRow[]): { rules: { field: string; op: string; value: string | number }[] } {
  return {
    rules: rows.map(r => ({
      field: r.field,
      op:    r.op,
      value: ['amount'].includes(r.field) && r.op !== 'in' ? Number(r.value) : r.value,
    })),
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  initial: Partial<ProcessingRule> | null
  onSave: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

function RuleModal({ initial, onSave, onClose }: ModalProps) {
  const isEdit = !!initial?.id

  const [name,      setName]      = useState(initial?.name        ?? '')
  const [desc,      setDesc]      = useState(initial?.description ?? '')
  const [priority,  setPriority]  = useState(String(initial?.priority ?? 10))
  const [track,     setTrack]     = useState<Track>(initial?.track ?? 'FULL_PO')
  const [needsGR,   setNeedsGR]   = useState(initial?.requiresGoodsReceipt ?? false)
  const [needsCont, setNeedsCont] = useState(initial?.requiresContract     ?? false)
  const [notes,     setNotes]     = useState(initial?.notes       ?? '')
  const [isActive,  setIsActive]  = useState(initial?.isActive    ?? true)
  const [rows,      setRows]      = useState<ConditionRow[]>(
    conditionsToRows(initial?.conditions)
  )
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  function addRow() {
    setRows(prev => [...prev, { field: 'amount', op: 'gte', value: '' }])
  }

  function removeRow(i: number) {
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateRow(i: number, key: keyof ConditionRow, val: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [key]: val } : r))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    const p = parseInt(priority, 10)
    if (isNaN(p) || p < 1) { setError('Priority must be a positive integer.'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name, description: desc || null, priority: p,
        track, requiresGoodsReceipt: needsGR, requiresContract: needsCont,
        conditions: rowsToConditions(rows),
        notes: notes || null,
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
      <div className="rounded-2xl w-full max-w-2xl overflow-y-auto" style={{ background: '#fff', border: '1px solid var(--border)', maxHeight: '90vh' }}>
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            {isEdit ? 'Edit Rule' : 'New Processing Rule'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          {/* Name + priority */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Name <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required
                placeholder="e.g. High-value PO route"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Priority <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input type="number" min="1" value={priority} onChange={e => setPriority(e.target.value)} required
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Description</label>
            <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Optional description…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>

          {/* Track */}
          <div>
            <label className="text-xs font-medium block mb-2" style={{ color: 'var(--muted)' }}>
              Processing Track <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TRACK_LABEL) as Track[]).map(t => {
                const active = track === t
                const col    = TRACK_COLOR[t]
                return (
                  <button key={t} type="button" onClick={() => setTrack(t)}
                    className="text-left px-3 py-2.5 rounded-xl text-sm transition-all"
                    style={{
                      border:     active ? `2px solid ${col.text}` : '1px solid var(--border)',
                      background: active ? col.bg : 'var(--surface)',
                      color:      active ? col.text : 'var(--muted)',
                    }}>
                    <div className="font-medium">{TRACK_LABEL[t]}</div>
                    <div className="text-xs mt-0.5 opacity-80">{TRACK_DESCRIPTION[t]}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Flags */}
          <div className="flex gap-6">
            {[
              { label: 'Requires Goods Receipt', val: needsGR,   set: setNeedsGR },
              { label: 'Requires Contract',       val: needsCont, set: setNeedsCont },
            ].map(({ label, val, set }) => (
              <label key={label} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                  style={{ accentColor: '#2563eb' }} />
                <span className="text-sm" style={{ color: 'var(--ink)' }}>{label}</span>
              </label>
            ))}
            {isEdit && (
              <label className="flex items-center gap-2 cursor-pointer ml-auto">
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
                  style={{ accentColor: '#2563eb' }} />
                <span className="text-sm" style={{ color: 'var(--ink)' }}>Active</span>
              </label>
            )}
          </div>

          {/* Conditions builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                Conditions (all must match)
              </label>
              <button type="button" onClick={addRow}
                className="text-xs px-2 py-1 rounded-lg"
                style={{ border: '1px solid var(--border)', color: '#2563eb' }}>
                + Add condition
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs py-3 text-center rounded-xl"
                style={{ color: 'var(--muted)', border: '1px dashed var(--border)' }}>
                No conditions — rule matches all invoices.
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select value={row.field} onChange={e => updateRow(i, 'field', e.target.value)}
                      className="px-2 py-1.5 rounded-xl text-xs outline-none"
                      style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                      {CONDITION_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <select value={row.op} onChange={e => updateRow(i, 'op', e.target.value)}
                      className="px-2 py-1.5 rounded-xl text-xs outline-none"
                      style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                      {CONDITION_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <input type="text" value={row.value} onChange={e => updateRow(i, 'value', e.target.value)}
                      placeholder={row.op === 'in' ? 'val1,val2,val3' : 'value'}
                      className="flex-1 px-2 py-1.5 rounded-xl text-xs outline-none"
                      style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
                    <button type="button" onClick={() => removeRow(i)}
                      className="px-2 py-1.5 rounded-xl text-xs"
                      style={{ color: '#dc2626', border: '1px solid #fecaca' }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Internal notes…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
              style={{ background: '#2563eb', color: '#fff' }}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ProcessingRulesPage() {
  const user = useUser()

  const [rules,   setRules]   = useState<ProcessingRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [modal,   setModal]   = useState<'new' | ProcessingRule | null>(null)
  const [toDelete, setToDelete] = useState<ProcessingRule | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isAdmin = user.role === 'ADMIN'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/processing-rules')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRules(data.rules)
    } catch {
      setError('Could not load processing rules.')
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
    const res = await fetch(
      editing ? `/api/processing-rules/${(modal as ProcessingRule).id}` : '/api/processing-rules',
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

  async function handleToggle(rule: ProcessingRule) {
    await fetch(`/api/processing-rules/${rule.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isActive: !rule.isActive }),
    })
    await load()
  }

  async function handleDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await fetch(`/api/processing-rules/${toDelete.id}`, { method: 'DELETE' })
      setToDelete(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Processing Rules</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Rules are evaluated in priority order — the first match determines the processing track.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setModal('new')}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Rule
          </button>
        )}
      </div>

      {/* Track legend */}
      <div className="flex gap-2 mt-4 mb-6 flex-wrap">
        {(Object.keys(TRACK_LABEL) as Track[]).map(t => {
          const col = TRACK_COLOR[t]
          return (
            <span key={t} className="px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ background: col.bg, color: col.text }}>
              {TRACK_LABEL[t]}
            </span>
          )
        })}
        <span className="text-xs px-2.5 py-1" style={{ color: 'var(--muted)' }}>← processing tracks</span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No processing rules</p>
          <p className="text-sm">Rules route invoices to the correct approval track based on conditions.</p>
          {isAdmin && (
            <button onClick={() => setModal('new')}
              className="text-sm mt-3 inline-block" style={{ color: '#2563eb' }}>
              Create your first rule →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, i) => {
            const col  = TRACK_COLOR[rule.track]
            const cond = rule.conditions as { rules?: { field: string; op: string; value: unknown }[] }
            const condCount = cond?.rules?.length ?? 0

            return (
              <div key={rule.id}
                className="rounded-2xl p-5"
                style={{
                  border:     `1px solid ${rule.isActive ? 'var(--border)' : '#e2e8f0'}`,
                  background: rule.isActive ? '#fff' : '#f8fafc',
                  opacity:    rule.isActive ? 1 : 0.7,
                }}>
                <div className="flex items-start gap-4">
                  {/* Priority badge */}
                  <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" style={{ color: 'var(--ink)' }}>{rule.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: col.bg, color: col.text }}>
                        {TRACK_LABEL[rule.track]}
                      </span>
                      {!rule.isActive && (
                        <span className="px-2 py-0.5 rounded-full text-xs"
                          style={{ background: '#f1f5f9', color: '#94a3b8' }}>Inactive</span>
                      )}
                      {rule.requiresGoodsReceipt && (
                        <span className="px-2 py-0.5 rounded-full text-xs"
                          style={{ background: '#fff7ed', color: '#ea580c' }}>GR Required</span>
                      )}
                      {rule.requiresContract && (
                        <span className="px-2 py-0.5 rounded-full text-xs"
                          style={{ background: '#f0fdf4', color: '#16a34a' }}>Contract Required</span>
                      )}
                    </div>

                    {rule.description && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{rule.description}</p>
                    )}

                    {/* Conditions summary */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {condCount === 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded-lg"
                          style={{ background: '#f8fafc', color: '#94a3b8', border: '1px dashed #cbd5e1' }}>
                          Matches all
                        </span>
                      ) : (
                        cond.rules!.map((r, ci) => (
                          <span key={ci} className="text-xs px-2 py-0.5 rounded-lg font-mono"
                            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>
                            {r.field} {CONDITION_OPS.find(o => o.value === r.op)?.label ?? r.op} {String(r.value)}
                          </span>
                        ))
                      )}
                    </div>

                    <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                      Priority {rule.priority} · Updated {fmtDate(rule.updatedAt)}
                      {rule.updater && ` by ${rule.updater.name ?? rule.updater.email}`}
                    </p>
                  </div>

                  {isAdmin && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => handleToggle(rule)}
                        className="px-3 py-1.5 rounded-xl text-xs"
                        style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                        {rule.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => setModal(rule)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium"
                        style={{ border: '1px solid #2563eb22', background: '#eff6ff', color: '#2563eb' }}>
                        Edit
                      </button>
                      <button onClick={() => setToDelete(rule)}
                        className="px-3 py-1.5 rounded-xl text-xs"
                        style={{ border: '1px solid #fecaca', color: '#dc2626' }}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modal !== null && (
        <RuleModal
          initial={modal === 'new' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirmation */}
      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Delete Rule</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
              Delete <strong>{toDelete.name}</strong>? Any invoices already routed by this rule will retain their track assignment.
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
