'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const FREQUENCIES = ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const
type Frequency = typeof FREQUENCIES[number]

interface Schedule {
  id:             string
  name:           string
  description:    string | null
  spendCategory:  string | null
  expectedAmount: number
  currency:       string
  frequency:      Frequency
  dayOfMonth:     number | null
  toleranceFixed: number
  tolerancePct:   number
  isActive:       boolean
  createdAt:      string
  entity:         { id: string; name: string; slug: string }
}

interface Entity { id: string; name: string; slug: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FREQ_LABEL: Record<Frequency, string> = {
  DAILY:     'Daily',
  WEEKLY:    'Weekly',
  BIWEEKLY:  'Bi-weekly',
  MONTHLY:   'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL:    'Annual',
}

const FREQ_DAYS: Record<Frequency, number> = {
  DAILY: 1, WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 30, QUARTERLY: 91, ANNUAL: 365,
}

function nextExpectedDate(frequency: Frequency, dayOfMonth: number | null): string {
  const now = new Date()

  if (frequency === 'MONTHLY' || frequency === 'QUARTERLY' || frequency === 'ANNUAL') {
    const dom = dayOfMonth ?? 1
    const candidate = new Date(now.getFullYear(), now.getMonth(), dom)
    if (candidate <= now) {
      const monthsAhead = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12
      candidate.setMonth(candidate.getMonth() + monthsAhead)
    }
    return candidate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const days = FREQ_DAYS[frequency]
  const next = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  entityId:       string
  name:           string
  description:    string
  spendCategory:  string
  expectedAmount: string
  currency:       string
  frequency:      Frequency
  dayOfMonth:     string
  toleranceFixed: string
  tolerancePct:   string
}

const EMPTY_FORM: FormState = {
  entityId: '', name: '', description: '', spendCategory: '',
  expectedAmount: '', currency: 'USD', frequency: 'MONTHLY',
  dayOfMonth: '', toleranceFixed: '', tolerancePct: '2',
}

function formFromSchedule(s: Schedule): FormState {
  return {
    entityId:       s.entity.id,
    name:           s.name,
    description:    s.description ?? '',
    spendCategory:  s.spendCategory ?? '',
    expectedAmount: String(s.expectedAmount),
    currency:       s.currency,
    frequency:      s.frequency,
    dayOfMonth:     s.dayOfMonth != null ? String(s.dayOfMonth) : '',
    toleranceFixed: String(s.toleranceFixed),
    tolerancePct:   String(Math.round(s.tolerancePct * 100)),
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RecurringSchedulesPage() {
  const { role } = useUser()

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  // Modal state
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editTarget,  setEditTarget]  = useState<Schedule | null>(null)
  const [form,        setForm]        = useState<FormState>(EMPTY_FORM)
  const [saving,      setSaving]      = useState(false)
  const [formError,   setFormError]   = useState<string | null>(null)

  // Entities for vendor picker
  const [entities, setEntities] = useState<Entity[]>([])

  // Toggle / delete in-flight
  const [toggling, setToggling] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/invoices/recurring')
      const json = await res.json() as { schedules: Schedule[]; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load')
      setSchedules(json.schedules)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!WRITE_ROLES.has(role ?? '')) return
    fetch('/api/entities?limit=200')
      .then(r => r.json())
      .then((j: { entities: Entity[] }) => setEntities(j.entities ?? []))
      .catch(() => {})
  }, [role])

  if (!role || !READ_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(s: Schedule) {
    setEditTarget(s)
    setForm(formFromSchedule(s))
    setFormError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditTarget(null)
    setFormError(null)
  }

  async function saveForm() {
    setFormError(null)
    if (!form.entityId)       { setFormError('Vendor is required'); return }
    if (!form.name.trim())    { setFormError('Name is required'); return }
    if (!form.expectedAmount || isNaN(Number(form.expectedAmount)) || Number(form.expectedAmount) <= 0) {
      setFormError('Expected amount must be a positive number'); return
    }

    setSaving(true)
    try {
      const body = {
        entityId:       form.entityId,
        name:           form.name.trim(),
        description:    form.description.trim() || undefined,
        spendCategory:  form.spendCategory.trim() || undefined,
        expectedAmount: Number(form.expectedAmount),
        currency:       form.currency,
        frequency:      form.frequency,
        dayOfMonth:     form.dayOfMonth ? Number(form.dayOfMonth) : undefined,
        toleranceFixed: form.toleranceFixed ? Number(form.toleranceFixed) : 0,
        tolerancePct:   form.tolerancePct  ? Number(form.tolerancePct) / 100 : 0.02,
      }

      const url    = editTarget ? `/api/invoices/recurring/${editTarget.id}` : '/api/invoices/recurring'
      const method = editTarget ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json() as { error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Save failed')

      await load()
      closeModal()
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function toggleActive(s: Schedule) {
    setToggling(s.id)
    try {
      await fetch(`/api/invoices/recurring/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !s.isActive }),
      })
      await load()
    } finally { setToggling(null) }
  }

  async function deleteSchedule(s: Schedule) {
    if (!confirm(`Deactivate "${s.name}"? It will no longer match incoming invoices.`)) return
    setDeleting(s.id)
    try {
      await fetch(`/api/invoices/recurring/${s.id}`, { method: 'DELETE' })
      await load()
    } finally { setDeleting(null) }
  }

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const active   = schedules.filter(s => s.isActive)
  const inactive = schedules.filter(s => !s.isActive)

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/invoices" className="text-sm" style={{ color: 'var(--muted)' }}>
            ← Invoices
          </Link>
          <span style={{ color: 'var(--muted)' }}>/</span>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Recurring Schedules</h1>
        </div>
        {WRITE_ROLES.has(role) && (
          <button onClick={openCreate}
            className="text-sm px-4 py-2 rounded-lg font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Schedule
          </button>
        )}
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-8">

        {loading && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading schedules…</p>
        )}
        {error && (
          <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>
        )}

        {!loading && schedules.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>No recurring schedules yet</p>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Schedules let the pipeline automatically match and validate recurring vendor invoices.
            </p>
            {WRITE_ROLES.has(role) && (
              <button onClick={openCreate}
                className="text-sm px-4 py-2 rounded-lg font-medium"
                style={{ background: '#2563eb', color: '#fff' }}>
                Create first schedule
              </button>
            )}
          </div>
        )}

        {/* Active schedules */}
        {active.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Active ({active.length})
            </h2>
            <div className="space-y-3">
              {active.map(s => (
                <ScheduleCard key={s.id} schedule={s}
                  canWrite={WRITE_ROLES.has(role)}
                  toggling={toggling === s.id}
                  deleting={deleting === s.id}
                  onEdit={() => openEdit(s)}
                  onToggle={() => toggleActive(s)}
                  onDelete={() => deleteSchedule(s)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Inactive schedules */}
        {inactive.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Inactive ({inactive.length})
            </h2>
            <div className="space-y-3 opacity-60">
              {inactive.map(s => (
                <ScheduleCard key={s.id} schedule={s}
                  canWrite={WRITE_ROLES.has(role)}
                  toggling={toggling === s.id}
                  deleting={deleting === s.id}
                  onEdit={() => openEdit(s)}
                  onToggle={() => toggleActive(s)}
                  onDelete={() => deleteSchedule(s)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="w-full max-w-lg rounded-2xl shadow-xl overflow-y-auto max-h-[90vh]"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>

            <div className="px-6 py-4 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--border)' }}>
              <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                {editTarget ? 'Edit Schedule' : 'New Recurring Schedule'}
              </h2>
              <button onClick={closeModal} className="text-lg leading-none" style={{ color: 'var(--muted)' }}>×</button>
            </div>

            <div className="p-6 space-y-4">

              {/* Vendor */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Vendor *</label>
                {editTarget ? (
                  <div className="text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}>
                    {editTarget.entity.name}
                  </div>
                ) : (
                  <select value={form.entityId} onChange={e => setForm(f => ({ ...f, entityId: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
                    <option value="">Select vendor…</option>
                    {entities.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Schedule Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Monthly SaaS subscription"
                  className="w-full text-sm px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
              </div>

              {/* Amount + Currency */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Expected Amount *</label>
                  <input value={form.expectedAmount} onChange={e => setForm(f => ({ ...f, expectedAmount: e.target.value }))}
                    type="number" min="0.01" step="0.01" placeholder="0.00"
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
                </div>
                <div className="w-24">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Currency</label>
                  <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
                    {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Frequency + Day of month */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Frequency</label>
                  <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as Frequency }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
                  </select>
                </div>
                {(form.frequency === 'MONTHLY' || form.frequency === 'QUARTERLY' || form.frequency === 'ANNUAL') && (
                  <div className="w-32">
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Day of month</label>
                    <input value={form.dayOfMonth} onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))}
                      type="number" min="1" max="28" placeholder="1"
                      className="w-full text-sm px-3 py-2 rounded-lg border"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
                  </div>
                )}
              </div>

              {/* Tolerance */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Tolerance %</label>
                  <input value={form.tolerancePct} onChange={e => setForm(f => ({ ...f, tolerancePct: e.target.value }))}
                    type="number" min="0" step="0.5" placeholder="2"
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Tolerance fixed</label>
                  <input value={form.toleranceFixed} onChange={e => setForm(f => ({ ...f, toleranceFixed: e.target.value }))}
                    type="number" min="0" step="0.01" placeholder="0.00"
                    className="w-full text-sm px-3 py-2 rounded-lg border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
                </div>
              </div>

              {/* Spend category */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Spend Category (optional)</label>
                <input value={form.spendCategory} onChange={e => setForm(f => ({ ...f, spendCategory: e.target.value }))}
                  placeholder="e.g. Software, Facilities, Marketing"
                  className="w-full text-sm px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Description (optional)</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2} placeholder="Notes about this schedule…"
                  className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
              </div>

              {formError && (
                <p className="text-xs" style={{ color: '#dc2626' }}>{formError}</p>
              )}
            </div>

            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={closeModal}
                className="text-sm px-4 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--bg)' }}>
                Cancel
              </button>
              <button onClick={saveForm} disabled={saving}
                className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50"
                style={{ background: '#2563eb', color: '#fff' }}>
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schedule card
// ---------------------------------------------------------------------------

function ScheduleCard({
  schedule, canWrite, toggling, deleting, onEdit, onToggle, onDelete,
}: {
  schedule: Schedule
  canWrite: boolean
  toggling: boolean
  deleting: boolean
  onEdit:   () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const s = schedule
  const tolerancePct   = `±${Math.round(s.tolerancePct * 100)}%`
  const toleranceFixed = s.toleranceFixed > 0 ? ` / ±${fmt(s.toleranceFixed, s.currency)}` : ''

  return (
    <div className="rounded-xl px-5 py-4 flex items-start justify-between gap-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

      {/* Left: info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{s.name}</span>
          <span className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
            {FREQ_LABEL[s.frequency]}
          </span>
          {s.spendCategory && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              {s.spendCategory}
            </span>
          )}
        </div>

        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          {s.entity.name}
        </div>

        <div className="flex items-center gap-4 text-xs flex-wrap" style={{ color: 'var(--muted)' }}>
          <span>
            Expected: <span className="font-medium" style={{ color: 'var(--ink)' }}>
              {fmt(s.expectedAmount, s.currency)}
            </span>
          </span>
          <span>Tolerance: {tolerancePct}{toleranceFixed}</span>
          {s.dayOfMonth && <span>Due: day {s.dayOfMonth}</span>}
          {s.isActive && (
            <span>
              Next: <span style={{ color: 'var(--ink)' }}>
                {nextExpectedDate(s.frequency, s.dayOfMonth)}
              </span>
            </span>
          )}
        </div>

        {s.description && (
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{s.description}</div>
        )}
      </div>

      {/* Right: actions */}
      {canWrite && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Active toggle */}
          <button
            onClick={onToggle}
            disabled={toggling}
            title={s.isActive ? 'Disable' : 'Enable'}
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50"
            style={{ background: s.isActive ? '#2563eb' : '#d1d5db' }}>
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
              style={{ transform: s.isActive ? 'translateX(18px)' : 'translateX(2px)' }} />
          </button>

          <button onClick={onEdit}
            className="text-xs px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--bg)' }}>
            Edit
          </button>

          <button onClick={onDelete} disabled={deleting}
            className="text-xs px-3 py-1.5 rounded-lg border disabled:opacity-50"
            style={{ borderColor: '#fca5a5', color: '#dc2626', background: '#fef2f2' }}>
            {deleting ? '…' : 'Remove'}
          </button>
        </div>
      )}
    </div>
  )
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
