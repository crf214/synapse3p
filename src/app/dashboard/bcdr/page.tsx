// Orphaned route — not in nav. BcDrRecord model retained in schema.
// Add to sidebar under a "GRC" or "Compliance" group when this is reactivated.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CISO', 'CONTROLLER'])

type RecordType   = 'BACKUP_VERIFICATION' | 'RTO_TEST' | 'RPO_TEST' | 'INCIDENT' | 'RECOVERY'
type ResultStatus = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_RUN' | 'ERROR'

const TYPE_LABEL: Record<RecordType, string> = {
  BACKUP_VERIFICATION: 'Backup Verification',
  RTO_TEST:            'RTO Test',
  RPO_TEST:            'RPO Test',
  INCIDENT:            'Incident',
  RECOVERY:            'Recovery',
}

const TYPE_COLOR: Record<RecordType, { bg: string; text: string }> = {
  BACKUP_VERIFICATION: { bg: '#eff6ff', text: '#2563eb' },
  RTO_TEST:            { bg: '#fdf4ff', text: '#9333ea' },
  RPO_TEST:            { bg: '#f5f3ff', text: '#7c3aed' },
  INCIDENT:            { bg: '#fef2f2', text: '#dc2626' },
  RECOVERY:            { bg: '#f0fdf4', text: '#16a34a' },
}

const STATUS_COLOR: Record<ResultStatus, { bg: string; text: string }> = {
  PASS:    { bg: '#f0fdf4', text: '#16a34a' },
  FAIL:    { bg: '#fef2f2', text: '#dc2626' },
  WARNING: { bg: '#fff7ed', text: '#ea580c' },
  NOT_RUN: { bg: '#f8fafc', text: '#94a3b8' },
  ERROR:   { bg: '#fef2f2', text: '#b91c1c' },
}

interface BcDrRecord {
  id:             string
  recordType:     RecordType
  status:         ResultStatus
  description:    string
  rtoTargetHours: number
  rpoTargetHours: number
  actualRtoHours: number | null
  actualRpoHours: number | null
  testedAt:       string
  notes:          string | null
  evidence:       unknown[]
  tester:         { id: string; name: string | null; email: string } | null
}

// ── Form modal ───────────────────────────────────────────────────────────────

interface ModalProps {
  initial: BcDrRecord | null
  onSave:  (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

function RecordModal({ initial, onSave, onClose }: ModalProps) {
  const isEdit = !!initial?.id

  const [recordType,     setRecordType]     = useState<RecordType>(initial?.recordType ?? 'RTO_TEST')
  const [status,         setStatus]         = useState<ResultStatus>(initial?.status   ?? 'NOT_RUN')
  const [description,    setDescription]    = useState(initial?.description    ?? '')
  const [testedAt,       setTestedAt]       = useState(
    initial?.testedAt ? initial.testedAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  )
  const [rtoTarget,      setRtoTarget]      = useState(String(initial?.rtoTargetHours ?? 8))
  const [rpoTarget,      setRpoTarget]      = useState(String(initial?.rpoTargetHours ?? 24))
  const [actualRto,      setActualRto]      = useState(initial?.actualRtoHours != null ? String(initial.actualRtoHours) : '')
  const [actualRpo,      setActualRpo]      = useState(initial?.actualRpoHours != null ? String(initial.actualRpoHours) : '')
  const [notes,          setNotes]          = useState(initial?.notes ?? '')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) { setError('Description is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        recordType, status, description, testedAt,
        rtoTargetHours: Number(rtoTarget),
        rpoTargetHours: Number(rpoTarget),
        actualRtoHours: actualRto ? Number(actualRto) : null,
        actualRpoHours: actualRpo ? Number(actualRpo) : null,
        notes: notes || null,
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
            {isEdit ? 'Edit Record' : 'New BC/DR Record'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Record Type <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select value={recordType} onChange={e => setRecordType(e.target.value as RecordType)}
                disabled={isEdit}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none disabled:opacity-60"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                {(Object.keys(TYPE_LABEL) as RecordType[]).map(t =>
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                )}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                Result <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <select value={status} onChange={e => setStatus(e.target.value as ResultStatus)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
                <option value="WARNING">Warning</option>
                <option value="NOT_RUN">Not Run</option>
                <option value="ERROR">Error</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
              Description <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} required
              placeholder="What was tested or what happened…"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>
              Test / Incident Date
            </label>
            <input type="date" value={testedAt} onChange={e => setTestedAt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </div>

          {/* RTO / RPO targets */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>RTO / RPO (hours)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>RTO Target</label>
                <input type="number" min="0" step="0.5" value={rtoTarget}
                  onChange={e => setRtoTarget(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>RPO Target</label>
                <input type="number" min="0" step="0.5" value={rpoTarget}
                  onChange={e => setRpoTarget(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Actual RTO</label>
                <input type="number" min="0" step="0.5" value={actualRto}
                  onChange={e => setActualRto(e.target.value)}
                  placeholder="—"
                  className="w-full px-3 py-1.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: 'var(--muted)' }}>Actual RPO</label>
                <input type="number" min="0" step="0.5" value={actualRpo}
                  onChange={e => setActualRpo(e.target.value)}
                  placeholder="—"
                  className="w-full px-3 py-1.5 rounded-xl text-sm outline-none"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--muted)' }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Findings, remediation steps, follow-up actions…"
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
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function BcDrPage() {
  const user = useUser()

  const [records,  setRecords]  = useState<BcDrRecord[]>([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [typeFilter,   setTypeFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page,     setPage]     = useState(1)
  const [modal,    setModal]    = useState<'new' | BcDrRecord | null>(null)
  const [toDelete, setToDelete] = useState<BcDrRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const canWrite = WRITE_ROLES.has(user.role ?? '')
  const canDelete = new Set(['ADMIN', 'CISO']).has(user.role ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(page) })
    if (typeFilter)   p.set('type',   typeFilter)
    if (statusFilter) p.set('status', statusFilter)
    try {
      const res = await fetch(`/api/bcdr?${p}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setRecords(d.records)
      setTotal(d.total)
    } catch {
      setError('Could not load BC/DR records.')
    } finally {
      setLoading(false)
    }
  }, [typeFilter, statusFilter, page])

  useEffect(() => { setPage(1) }, [typeFilter, statusFilter])
  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  async function handleSave(data: Record<string, unknown>) {
    const editing = modal !== 'new' && modal !== null
    const res = await apiClient(
      editing ? `/api/bcdr/${(modal as BcDrRecord).id}` : '/api/bcdr',
      { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
    )
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error?.message ?? 'Save failed')
    }
    setModal(null)
    await load()
  }

  async function handleDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await apiClient(`/api/bcdr/${toDelete.id}`, { method: 'DELETE' })
      setToDelete(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function rtoRpoColor(actual: number | null, target: number) {
    if (actual === null) return 'var(--muted)'
    return actual <= target ? '#16a34a' : '#dc2626'
  }

  // Summary stats from current page
  const passCount = records.filter(r => r.status === 'PASS').length
  const failCount = records.filter(r => r.status === 'FAIL').length
  const lastTest  = records[0]?.testedAt ?? null

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>BC/DR Records</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {total} record{total !== 1 ? 's' : ''}
            {failCount > 0 && <span style={{ color: '#dc2626' }}> · {failCount} failed</span>}
            {passCount > 0 && <span style={{ color: '#16a34a' }}> · {passCount} passed</span>}
            {lastTest && <span> · Last test {fmtDate(lastTest)}</span>}
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setModal('new')}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Record
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mt-5 mb-6 flex-wrap">
        {/* Type tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {(['', ...Object.keys(TYPE_LABEL)] as const).map(t => {
            const active = typeFilter === t
            return (
              <button key={t} onClick={() => setTypeFilter(t)}
                className="px-3 py-1.5 rounded-full text-xs font-medium"
                style={{
                  background: active ? '#2563eb' : 'var(--surface)',
                  color:      active ? '#fff'    : 'var(--muted)',
                  border:     active ? 'none'    : '1px solid var(--border)',
                }}>
                {t === '' ? 'All Types' : TYPE_LABEL[t as RecordType]}
              </button>
            )
          })}
        </div>

        {/* Status filter */}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-xl text-xs outline-none"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>
          <option value="">All Results</option>
          <option value="PASS">Pass</option>
          <option value="FAIL">Fail</option>
          <option value="WARNING">Warning</option>
          <option value="NOT_RUN">Not Run</option>
          <option value="ERROR">Error</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : records.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No BC/DR records</p>
          <p className="text-sm">Log backup verifications, RTO/RPO tests, incidents, and recoveries here.</p>
          {canWrite && (
            <button onClick={() => setModal('new')} className="text-sm mt-3 inline-block" style={{ color: '#2563eb' }}>
              Create first record →
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {records.map(record => {
              const tCol = TYPE_COLOR[record.recordType]
              const sCol = STATUS_COLOR[record.status]

              return (
                <div key={record.id} className="rounded-2xl p-5"
                  style={{ border: '1px solid var(--border)', background: '#fff' }}>
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: tCol.bg, color: tCol.text }}>
                          {TYPE_LABEL[record.recordType]}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: sCol.bg, color: sCol.text }}>
                          {record.status}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          {fmtDate(record.testedAt)}
                          {record.tester && ` · ${record.tester.name ?? record.tester.email}`}
                        </span>
                      </div>

                      <p className="text-sm mt-1" style={{ color: 'var(--ink)' }}>{record.description}</p>

                      {/* RTO / RPO metrics */}
                      <div className="flex gap-6 mt-3">
                        {/* RTO */}
                        <div>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>RTO</p>
                          <p className="text-sm font-medium mt-0.5">
                            <span style={{ color: 'var(--muted)' }}>Target {record.rtoTargetHours}h</span>
                            {record.actualRtoHours !== null && (
                              <span className="ml-2" style={{ color: rtoRpoColor(record.actualRtoHours, record.rtoTargetHours) }}>
                                Actual {record.actualRtoHours}h
                                {record.actualRtoHours > record.rtoTargetHours && ' ▲'}
                                {record.actualRtoHours <= record.rtoTargetHours && ' ✓'}
                              </span>
                            )}
                          </p>
                        </div>
                        {/* RPO */}
                        <div>
                          <p className="text-xs" style={{ color: 'var(--muted)' }}>RPO</p>
                          <p className="text-sm font-medium mt-0.5">
                            <span style={{ color: 'var(--muted)' }}>Target {record.rpoTargetHours}h</span>
                            {record.actualRpoHours !== null && (
                              <span className="ml-2" style={{ color: rtoRpoColor(record.actualRpoHours, record.rpoTargetHours) }}>
                                Actual {record.actualRpoHours}h
                                {record.actualRpoHours > record.rpoTargetHours && ' ▲'}
                                {record.actualRpoHours <= record.rpoTargetHours && ' ✓'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      {record.notes && (
                        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{record.notes}</p>
                      )}
                    </div>

                    {(canWrite || canDelete) && (
                      <div className="flex gap-1.5 flex-shrink-0">
                        {canWrite && (
                          <button onClick={() => setModal(record)}
                            className="px-3 py-1.5 rounded-xl text-xs font-medium"
                            style={{ border: '1px solid #2563eb22', background: '#eff6ff', color: '#2563eb' }}>
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => setToDelete(record)}
                            className="px-3 py-1.5 rounded-xl text-xs"
                            style={{ border: '1px solid #fecaca', color: '#dc2626' }}>
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {total > 50 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Previous</button>
              <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Next</button>
            </div>
          )}
        </>
      )}

      {modal !== null && (
        <RecordModal
          initial={modal === 'new' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="rounded-2xl p-6 w-full max-w-sm" style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Delete Record</h2>
            <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
              Delete this {TYPE_LABEL[toDelete.recordType]} record from {fmtDate(toDelete.testedAt)}? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setToDelete(null)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Cancel</button>
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
