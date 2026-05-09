'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CFO', 'CONTROLLER'])
const LOCK_ROLES    = new Set(['ADMIN'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PeriodStatus = 'OPEN' | 'CLOSED' | 'LOCKED'

interface AuditPeriod {
  id:           string
  name:         string
  framework:    string
  periodStart:  string
  periodEnd:    string
  status:       PeriodStatus
  openedBy:     string
  closedBy:     string | null
  closedAt:     string | null
  lockedBy:     string | null
  lockedAt:     string | null
  auditorNotes: string | null
  createdAt:    string
  _count:       { testResults: number; evidence: number }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_STYLE: Record<PeriodStatus, { bg: string; color: string; border: string }> = {
  OPEN:   { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22' },
  CLOSED: { bg: '#fffbeb', color: '#d97706', border: '#d9770622' },
  LOCKED: { bg: '#f9fafb', color: '#6b7280', border: '#6b728022' },
}

function StatusBadge({ status }: { status: PeriodStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  )
}

function daysRemaining(isoEnd: string): number {
  return Math.ceil((new Date(isoEnd).getTime() - Date.now()) / 86_400_000)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// New period form
// ---------------------------------------------------------------------------
interface NewPeriodFormProps {
  onCreated: () => void
  onCancel:  () => void
}

function NewPeriodForm({ onCreated, onCancel }: NewPeriodFormProps) {
  const [name,        setName]        = useState('')
  const [framework,   setFramework]   = useState('SOC2')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd,   setPeriodEnd]   = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await apiClient('/api/audit-periods', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, framework, periodStart, periodEnd }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: { message: string; code: string } }
        throw new Error(d.error?.message ?? `HTTP ${res.status}`)
      }
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create period')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full px-3 py-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500'
  const inputStyle = { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }

  return (
    <form onSubmit={submit}
      className="rounded-2xl p-5 space-y-4"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
      <h2 className="font-medium text-sm" style={{ color: 'var(--ink)' }}>New audit period</h2>

      {error && (
        <div className="text-xs px-3 py-2 rounded-lg"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262622' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--muted)' }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. SOC2 Type II — Q1 2026"
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--muted)' }}>
            Framework
          </label>
          <select
            value={framework}
            onChange={e => setFramework(e.target.value)}
            className={inputClass}
            style={inputStyle}>
            <option value="SOC2">SOC2</option>
            <option value="SOX">SOX</option>
            <option value="INTERNAL">INTERNAL</option>
          </select>
        </div>

        <div />

        <div>
          <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--muted)' }}>
            Period start
          </label>
          <input
            type="date"
            value={periodStart}
            onChange={e => setPeriodStart(e.target.value)}
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label className="block text-xs mb-1.5 font-medium" style={{ color: 'var(--muted)' }}>
            Period end
          </label>
          <input
            type="date"
            value={periodEnd}
            onChange={e => setPeriodEnd(e.target.value)}
            required
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
          style={{ background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }}>
          {submitting ? 'Creating…' : 'Create period'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium px-4 py-2 rounded-xl"
          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AuditPeriodsPage() {
  const { role } = useUser()
  const router   = useRouter()

  const [periods,      setPeriods]      = useState<AuditPeriod[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [showForm,     setShowForm]     = useState(false)
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set())
  const [acting,       setActing]       = useState<Set<string>>(new Set())
  const [actionError,  setActionError]  = useState<Record<string, string>>({})

  const canWrite = WRITE_ROLES.has(role ?? '')
  const canLock  = LOCK_ROLES.has(role  ?? '')

  const fetchPeriods = useCallback(() => {
    setLoading(true)
    fetch('/api/audit-periods')
      .then(r => r.json())
      .then((d: { periods: AuditPeriod[] }) => setPeriods(d.periods ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!ALLOWED_ROLES.has(role ?? '')) { router.replace('/dashboard'); return }
    fetchPeriods()
  }, [role, router, fetchPeriods])

  async function doAction(periodId: string, action: 'close' | 'lock') {
    setActing(prev => new Set([...prev, periodId]))
    setActionError(prev => { const n = { ...prev }; delete n[periodId]; return n })
    try {
      const res = await apiClient(`/api/audit-periods/${periodId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json() as { error?: { message: string; code: string } }
        throw new Error(d.error?.message ?? `HTTP ${res.status}`)
      }
      fetchPeriods()
    } catch (err) {
      setActionError(prev => ({ ...prev, [periodId]: err instanceof Error ? err.message : 'Action failed' }))
    } finally {
      setActing(prev => { const s = new Set(prev); s.delete(periodId); return s })
    }
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>

  const th = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-4 py-3 text-sm'

  return (
    <div className="p-8 max-w-6xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>Audit Periods</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Manage audit engagement windows and lock periods for evidence preservation
          </p>
        </div>
        {canWrite && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-sm font-medium px-4 py-2 rounded-xl"
            style={{ background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }}>
            New audit period
          </button>
        )}
      </div>

      {/* Inline form */}
      {showForm && (
        <NewPeriodForm
          onCreated={() => { setShowForm(false); fetchPeriods() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Table */}
      {periods.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No audit periods yet.</p>
          {canWrite && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-sm font-medium"
              style={{ color: '#2563eb' }}>
              Create the first one →
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full">
            <thead style={{ background: 'var(--surface)' }}>
              <tr>
                {['Name', 'Framework', 'Period', 'Status', 'Days remaining', 'Tests / Evidence', 'Actions'].map(h => (
                  <th key={h} className={th}
                    style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => {
                const isExpanded = expanded.has(p.id)
                const isActing   = acting.has(p.id)
                const days       = daysRemaining(p.periodEnd)
                const canClose   = canWrite && p.status === 'OPEN'  && days <= 0
                const canLockPeriod = canLock && p.status === 'CLOSED'

                return (
                  <>
                    <tr
                      key={p.id}
                      onClick={() => toggleExpanded(p.id)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>

                      {/* Name */}
                      <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                        <div className="flex items-center gap-2">
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                            {isExpanded ? '▾' : '▸'}
                          </span>
                          {p.name}
                        </div>
                      </td>

                      {/* Framework */}
                      <td className={td}>
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                          {p.framework}
                        </span>
                      </td>

                      {/* Period dates */}
                      <td className={td} style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}
                      </td>

                      {/* Status */}
                      <td className={td}>
                        <StatusBadge status={p.status} />
                      </td>

                      {/* Days remaining */}
                      <td className={td}>
                        {p.status === 'OPEN' ? (
                          <span className="tabular-nums text-sm"
                            style={{ color: days <= 0 ? '#dc2626' : days <= 7 ? '#d97706' : 'var(--muted)' }}>
                            {days <= 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>

                      {/* Counts */}
                      <td className={td} style={{ color: 'var(--muted)' }}>
                        {p._count.testResults} / {p._count.evidence}
                      </td>

                      {/* Actions */}
                      <td className={td} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 flex-wrap">
                          {canClose && (
                            <button
                              onClick={() => doAction(p.id, 'close')}
                              disabled={isActing}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg disabled:opacity-40"
                              style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #d9770622' }}>
                              {isActing ? '…' : 'Close'}
                            </button>
                          )}
                          {canLockPeriod && (
                            <button
                              onClick={() => doAction(p.id, 'lock')}
                              disabled={isActing}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg disabled:opacity-40"
                              style={{ background: '#f9fafb', color: '#6b7280', border: '1px solid #6b728022' }}>
                              {isActing ? '…' : 'Lock'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded notes row */}
                    {isExpanded && (
                      <tr key={`${p.id}-expanded`}
                        style={{ background: '#fafafa', borderTop: '1px solid var(--border)' }}>
                        <td colSpan={7} className="px-6 py-4">
                          <div className="space-y-2 text-sm">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                              <div>
                                <span className="font-medium">Opened by</span>
                                <div className="font-mono mt-0.5">{p.openedBy}</div>
                              </div>
                              {p.closedBy && (
                                <div>
                                  <span className="font-medium">Closed by</span>
                                  <div className="font-mono mt-0.5">{p.closedBy}</div>
                                  <div className="mt-0.5" style={{ color: 'var(--muted)' }}>{p.closedAt ? fmtDate(p.closedAt) : ''}</div>
                                </div>
                              )}
                              {p.lockedBy && (
                                <div>
                                  <span className="font-medium">Locked by</span>
                                  <div className="font-mono mt-0.5">{p.lockedBy}</div>
                                  <div className="mt-0.5">{p.lockedAt ? fmtDate(p.lockedAt) : ''}</div>
                                </div>
                              )}
                              <div>
                                <span className="font-medium">Test results</span>
                                <div className="mt-0.5">{p._count.testResults} recorded</div>
                              </div>
                              <div>
                                <span className="font-medium">Evidence items</span>
                                <div className="mt-0.5">{p._count.evidence} collected</div>
                              </div>
                            </div>
                            {p.auditorNotes && (
                              <div>
                                <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                                  Auditor notes
                                </span>
                                <p className="mt-1 text-sm" style={{ color: 'var(--ink)' }}>{p.auditorNotes}</p>
                              </div>
                            )}
                            {!p.auditorNotes && (
                              <p className="text-xs" style={{ color: 'var(--muted)' }}>No auditor notes.</p>
                            )}
                            {actionError[p.id] && (
                              <p className="text-xs" style={{ color: '#dc2626' }}>{actionError[p.id]}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footnote */}
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Click a row to expand auditor notes and lifecycle details.
        Locked periods are immutable — no new test results or evidence can be added.
      </p>
    </div>
  )
}
