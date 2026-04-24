'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

type ReviewStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
type ReviewType   = 'ONBOARDING' | 'PERIODIC' | 'EVENT_TRIGGERED'

interface ReviewRow {
  id:             string
  reviewType:     ReviewType
  status:         ReviewStatus
  overallScore:   number | null
  cyberScore:     number | null
  legalScore:     number | null
  privacyScore:   number | null
  scheduledAt:    string | null
  completedAt:    string | null
  nextReviewDate: string | null
  triggerEvent:   string | null
  createdAt:      string
  entity:         { id: string; name: string }
}

interface EntityOption { id: string; name: string }

const STATUS_COLOR: Record<ReviewStatus, { bg: string; text: string }> = {
  SCHEDULED:   { bg: '#eff6ff', text: '#2563eb' },
  IN_PROGRESS: { bg: '#fff7ed', text: '#ea580c' },
  COMPLETED:   { bg: '#f0fdf4', text: '#16a34a' },
  OVERDUE:     { bg: '#fef2f2', text: '#dc2626' },
  CANCELLED:   { bg: '#f8fafc', text: '#64748b' },
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: 'var(--muted)' }}>—</span>
  const color = score >= 7 ? '#16a34a' : score >= 4 ? '#ea580c' : '#dc2626'
  return <span style={{ color, fontWeight: 600 }}>{score.toFixed(1)}</span>
}

export default function ReviewsPage() {
  const user   = useUser()
  const router = useRouter()

  const [rows,      setRows]      = useState<ReviewRow[]>([])
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [status,    setStatus]    = useState('')
  const [type,      setType]      = useState('')
  const [entityId,  setEntityId]  = useState('')
  const [entities,  setEntities]  = useState<EntityOption[]>([])
  const [showNew,   setShowNew]   = useState(false)
  const [newForm,   setNewForm]   = useState({ entityId: '', reviewType: 'PERIODIC', notes: '', scheduledAt: '' })
  const [creating,  setCreating]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams()
    if (status)   p.set('status', status)
    if (type)     p.set('type',   type)
    if (entityId) p.set('entityId', entityId)
    try {
      const res = await fetch(`/api/reviews?${p}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.reviews)
      setTotal(data.total)
    } catch {
      setError('Could not load reviews.')
    } finally {
      setLoading(false)
    }
  }, [status, type, entityId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/entities?limit=200')
      .then(r => r.json())
      .then(d => setEntities((d.entities ?? []).map((e: EntityOption) => ({ id: e.id, name: e.name }))))
      .catch(() => {})
  }, [])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  async function createReview() {
    if (!newForm.entityId) return
    setCreating(true)
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId:    newForm.entityId,
          reviewType:  newForm.reviewType,
          notes:       newForm.notes || null,
          scheduledAt: newForm.scheduledAt || null,
          status:      newForm.scheduledAt ? 'SCHEDULED' : 'IN_PROGRESS',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? 'Failed')
      setShowNew(false)
      setNewForm({ entityId: '', reviewType: 'PERIODIC', notes: '', scheduledAt: '' })
      router.push(`/dashboard/reviews/${data.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Third-Party Reviews</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{total} review{total !== 1 ? 's' : ''}</p>
        </div>
        {WRITE_ROLES.has(user.role ?? '') && (
          <button onClick={() => setShowNew(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Review
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All statuses</option>
          {['SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE','CANCELLED'].map(s => (
            <option key={s} value={s}>{s.replace('_',' ')}</option>
          ))}
        </select>
        <select value={type} onChange={e => setType(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All types</option>
          {['ONBOARDING','PERIODIC','EVENT_TRIGGERED'].map(t => (
            <option key={t} value={t}>{t.replace('_',' ')}</option>
          ))}
        </select>
        <select value={entityId} onChange={e => setEntityId(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No reviews found</p>
          {WRITE_ROLES.has(user.role ?? '') && (
            <button onClick={() => setShowNew(true)} className="text-sm" style={{ color: '#2563eb' }}>
              Start the first review →
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                {['Entity','Type','Status','Overall','Cyber','Legal','Privacy','Scheduled','Next Due'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                    style={{ color: 'var(--muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const col = STATUS_COLOR[r.status]
                return (
                  <tr key={r.id}
                    onClick={() => router.push(`/dashboard/reviews/${r.id}`)}
                    className="cursor-pointer transition-colors hover:bg-blue-50"
                    style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/entities/${r.entity.id}`}
                        onClick={e => e.stopPropagation()}
                        className="hover:underline font-medium" style={{ color: 'var(--ink)' }}>
                        {r.entity.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {r.reviewType.replace('_',' ')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: col.bg, color: col.text }}>
                        {r.status.replace('_',' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs"><ScoreBadge score={r.overallScore} /></td>
                    <td className="px-4 py-3 text-xs"><ScoreBadge score={r.cyberScore} /></td>
                    <td className="px-4 py-3 text-xs"><ScoreBadge score={r.legalScore} /></td>
                    <td className="px-4 py-3 text-xs"><ScoreBadge score={r.privacyScore} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(r.scheduledAt)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(r.nextReviewDate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New review modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00000055' }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--ink)' }}>New Third-Party Review</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>
                  Entity <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select value={newForm.entityId}
                  onChange={e => setNewForm(f => ({ ...f, entityId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }}>
                  <option value="">Select entity…</option>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Review Type</label>
                <select value={newForm.reviewType}
                  onChange={e => setNewForm(f => ({ ...f, reviewType: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }}>
                  <option value="PERIODIC">Periodic</option>
                  <option value="ONBOARDING">Onboarding</option>
                  <option value="EVENT_TRIGGERED">Event Triggered</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Scheduled Date (optional)</label>
                <input type="date" value={newForm.scheduledAt}
                  onChange={e => setNewForm(f => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Notes</label>
                <textarea rows={2} value={newForm.notes}
                  onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm resize-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowNew(false)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button onClick={createReview} disabled={creating || !newForm.entityId}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ background: '#2563eb', color: '#fff' }}>
                {creating ? 'Creating…' : 'Create Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
