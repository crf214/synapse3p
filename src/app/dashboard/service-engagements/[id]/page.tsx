'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

type EngStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW' | 'OFFBOARDED'
type SlaStatus = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'NOT_APPLICABLE'

interface EngDetail {
  id:             string
  status:         EngStatus
  slaStatus:      SlaStatus
  slaTarget:      string | null
  department:     string | null
  internalOwner:  string | null
  contractStart:  string | null
  contractEnd:    string | null
  lastReviewedAt: string | null
  complianceDocs: unknown[]
  notes:          string | null
  createdAt:      string
  updatedAt:      string
  entity:         { id: string; name: string }
  service:        { id: string; name: string; category: string; description: string | null }
  owner:          { id: string; name: string | null; email: string } | null
}

interface UserOption { id: string; name: string | null; email: string }

const STATUS_COLOR: Record<EngStatus, { bg: string; text: string }> = {
  ACTIVE:         { bg: '#f0fdf4', text: '#16a34a' },
  INACTIVE:       { bg: '#f8fafc', text: '#64748b' },
  SUSPENDED:      { bg: '#fef2f2', text: '#dc2626' },
  PENDING_REVIEW: { bg: '#fff7ed', text: '#ea580c' },
  OFFBOARDED:     { bg: '#f1f5f9', text: '#475569' },
}

const SLA_COLOR: Record<SlaStatus, { bg: string; text: string }> = {
  ON_TRACK:       { bg: '#f0fdf4', text: '#16a34a' },
  AT_RISK:        { bg: '#fff7ed', text: '#ea580c' },
  BREACHED:       { bg: '#fef2f2', text: '#dc2626' },
  NOT_APPLICABLE: { bg: '#f8fafc', text: '#94a3b8' },
}

const STATUS_LABEL: Record<EngStatus, string> = {
  ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended',
  PENDING_REVIEW: 'Pending Review', OFFBOARDED: 'Offboarded',
}

const SLA_LABEL: Record<SlaStatus, string> = {
  ON_TRACK: 'On Track', AT_RISK: 'At Risk', BREACHED: 'Breached', NOT_APPLICABLE: 'N/A',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function ServiceEngagementDetailPage() {
  const user   = useUser()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [eng,     setEng]     = useState<EngDetail | null>(null)
  const [users,   setUsers]   = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [editing, setEditing] = useState(false)

  // Edit state
  const [editStatus,        setEditStatus]        = useState<EngStatus>('ACTIVE')
  const [editSlaStatus,     setEditSlaStatus]      = useState<SlaStatus>('NOT_APPLICABLE')
  const [editSlaTarget,     setEditSlaTarget]      = useState('')
  const [editDepartment,    setEditDepartment]     = useState('')
  const [editOwner,         setEditOwner]          = useState('')
  const [editContractStart, setEditContractStart]  = useState('')
  const [editContractEnd,   setEditContractEnd]    = useState('')
  const [editNotes,         setEditNotes]          = useState('')

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting,        setDeleting]        = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [engRes, usrRes] = await Promise.all([
        fetch(`/api/service-engagements/${id}`),
        fetch('/api/users'),
      ])
      if (!engRes.ok) throw new Error()
      const data: EngDetail = await engRes.json()
      setEng(data)
      // Seed edit state
      setEditStatus(data.status)
      setEditSlaStatus(data.slaStatus)
      setEditSlaTarget(data.slaTarget ?? '')
      setEditDepartment(data.department ?? '')
      setEditOwner(data.internalOwner ?? '')
      setEditContractStart(data.contractStart ? data.contractStart.slice(0,10) : '')
      setEditContractEnd(data.contractEnd ? data.contractEnd.slice(0,10) : '')
      setEditNotes(data.notes ?? '')
      if (usrRes.ok) {
        const d = await usrRes.json()
        setUsers(d.users ?? d ?? [])
      }
    } catch {
      setError('Could not load engagement.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  const canWrite = WRITE_ROLES.has(user.role ?? '')

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/service-engagements/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:        editStatus,
          slaStatus:     editSlaStatus,
          slaTarget:     editSlaTarget     || null,
          department:    editDepartment    || null,
          internalOwner: editOwner         || null,
          contractStart: editContractStart || null,
          contractEnd:   editContractEnd   || null,
          notes:         editNotes         || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.message ?? 'Save failed')
      }
      setEditing(false)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function markReviewed() {
    setSaving(true)
    try {
      await fetch(`/api/service-engagements/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ markReviewed: true }),
      })
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/service-engagements/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error?.message ?? 'Delete failed')
      }
      router.push('/dashboard/service-engagements')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
      setDeleting(false)
    }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error && !eng) return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error}</div>
  if (!eng) return null

  const sCol      = STATUS_COLOR[eng.status]
  const slaCol    = SLA_COLOR[eng.slaStatus]
  const days      = daysUntil(eng.contractEnd)
  const expiring  = days !== null && days >= 0 && days <= 30
  const expired   = days !== null && days < 0

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.back()} className="text-sm mb-3 hover:underline" style={{ color: 'var(--muted)' }}>
          ← Service Engagements
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>{eng.entity.name}</h1>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: sCol.bg, color: sCol.text }}>
                {STATUS_LABEL[eng.status]}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: slaCol.bg, color: slaCol.text }}>
                SLA: {SLA_LABEL[eng.slaStatus]}
              </span>
            </div>
            <p className="text-base" style={{ color: 'var(--muted)' }}>
              {eng.service.name}
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: '#f1f5f9', color: '#475569' }}>
                {eng.service.category.replace('_', ' ')}
              </span>
            </p>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button onClick={() => { setEditing(false); load() }}
                    className="px-4 py-2 rounded-xl text-sm"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={markReviewed} disabled={saving}
                    className="px-4 py-2 rounded-xl text-sm"
                    style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                    Mark Reviewed
                  </button>
                  <button onClick={() => setEditing(true)}
                    className="px-4 py-2 rounded-xl text-sm font-medium"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    Edit
                  </button>
                  <button onClick={() => setShowDeleteModal(true)}
                    className="px-4 py-2 rounded-xl text-sm"
                    style={{ border: '1px solid #fecaca', color: '#dc2626' }}>
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-8">
        {/* Main */}
        <div className="col-span-2 space-y-6">
          {/* Contract dates */}
          <div className="rounded-2xl p-6 space-y-4" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Contract</h2>
            {editing ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Start Date</label>
                  <input type="date" value={editContractStart} onChange={e => setEditContractStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>End Date</label>
                  <input type="date" value={editContractEnd} onChange={e => setEditContractEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Start</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--ink)' }}>
                    {fmtDate(eng.contractStart)}
                  </p>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>End</p>
                  <p className="text-sm font-medium mt-0.5"
                    style={{ color: expired ? '#dc2626' : expiring ? '#ea580c' : 'var(--ink)' }}>
                    {fmtDate(eng.contractEnd)}
                    {expired  && <span className="ml-1 text-xs">(expired)</span>}
                    {expiring && !expired && <span className="ml-1 text-xs">({days}d remaining)</span>}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* SLA */}
          <div className="rounded-2xl p-6 space-y-4" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>SLA</h2>
            {editing ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Status</label>
                  <select value={editSlaStatus} onChange={e => setEditSlaStatus(e.target.value as SlaStatus)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}>
                    <option value="NOT_APPLICABLE">N/A</option>
                    <option value="ON_TRACK">On Track</option>
                    <option value="AT_RISK">At Risk</option>
                    <option value="BREACHED">Breached</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Target</label>
                  <input type="text" value={editSlaTarget} onChange={e => setEditSlaTarget(e.target.value)}
                    placeholder="e.g. 99.9% uptime"
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Status</p>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: slaCol.bg, color: slaCol.text }}>
                    {SLA_LABEL[eng.slaStatus]}
                  </span>
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>Target</p>
                  <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--ink)' }}>
                    {eng.slaTarget ?? '—'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Compliance docs */}
          {Array.isArray(eng.complianceDocs) && eng.complianceDocs.length > 0 && (
            <div className="rounded-2xl p-6" style={{ border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Compliance Documents</h2>
              <pre className="text-xs overflow-auto rounded-xl p-3"
                style={{ background: '#f8fafc', color: '#475569', maxHeight: 200 }}>
                {JSON.stringify(eng.complianceDocs, null, 2)}
              </pre>
            </div>
          )}

          {/* Notes */}
          <div className="rounded-2xl p-6" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Notes</h2>
            {editing ? (
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={4}
                placeholder="Internal notes…"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
            ) : (
              <p className="text-sm whitespace-pre-wrap" style={{ color: eng.notes ? 'var(--ink)' : 'var(--muted)' }}>
                {eng.notes ?? 'No notes.'}
              </p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Details */}
          <div className="rounded-2xl p-5 space-y-4" style={{ border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>Details</h3>

            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Status</label>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value as EngStatus)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}>
                    <option value="ACTIVE">Active</option>
                    <option value="PENDING_REVIEW">Pending Review</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="SUSPENDED">Suspended</option>
                    <option value="OFFBOARDED">Offboarded</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Department</label>
                  <input type="text" value={editDepartment} onChange={e => setEditDepartment(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Internal Owner</label>
                  <select value={editOwner} onChange={e => setEditOwner(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                    style={{ border: '1px solid var(--border)', color: 'var(--ink)' }}>
                    <option value="">Unassigned</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <>
                {[
                  { label: 'Entity',        value: <Link href={`/dashboard/entities/${eng.entity.id}`} className="hover:underline" style={{ color: '#2563eb' }}>{eng.entity.name}</Link> },
                  { label: 'Service',       value: eng.service.name },
                  { label: 'Category',      value: eng.service.category.replace('_', ' ') },
                  { label: 'Department',    value: eng.department ?? '—' },
                  { label: 'Owner',         value: eng.owner?.name ?? eng.owner?.email ?? '—' },
                  { label: 'Last Reviewed', value: eng.lastReviewedAt ? fmtDate(eng.lastReviewedAt) : '—' },
                  { label: 'Created',       value: fmtDateTime(eng.createdAt) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{label}</p>
                    <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--ink)' }}>{value}</p>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Service description */}
          {eng.service.description && (
            <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--ink)' }}>Service Description</h3>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{eng.service.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Delete Engagement</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
              Remove the {eng.service.name} engagement for {eng.entity.name}? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteModal(false)}
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
