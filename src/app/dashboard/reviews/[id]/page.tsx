'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

type ReviewStatus  = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
type ReviewType    = 'ONBOARDING' | 'PERIODIC' | 'EVENT_TRIGGERED'
type ActivityType  = string

interface ReviewDetail {
  id:              string
  reviewType:      ReviewType
  status:          ReviewStatus
  cyberScore:      number | null
  legalScore:      number | null
  privacyScore:    number | null
  overallScore:    number | null
  cyberFindings:   Record<string, string>
  legalFindings:   Record<string, string>
  privacyFindings: Record<string, string>
  notes:           string | null
  triggerEvent:    string | null
  scheduledAt:     string | null
  completedAt:     string | null
  nextReviewDate:  string | null
  createdAt:       string
  updatedAt:       string
  entity:   { id: string; name: string; riskScores: { computedScore: number }[] } | null
  reviewer: { id: string; name: string | null; email: string } | null
  approver: { id: string; name: string | null; email: string } | null
}

interface ActivityLog {
  id:           string
  activityType: ActivityType
  title:        string
  description:  string | null
  performedBy:  string | null
  occurredAt:   string
}

type FindingsKV = { key: string; value: string }[]

const STATUS_COLOR: Record<ReviewStatus, { bg: string; text: string }> = {
  SCHEDULED:   { bg: '#eff6ff', text: '#2563eb' },
  IN_PROGRESS: { bg: '#fff7ed', text: '#ea580c' },
  COMPLETED:   { bg: '#f0fdf4', text: '#16a34a' },
  OVERDUE:     { bg: '#fef2f2', text: '#dc2626' },
  CANCELLED:   { bg: '#f8fafc', text: '#64748b' },
}

const ACTIVITY_ICON: Record<string, string> = {
  REVIEW: '🔍', ONBOARDING: '🆕', STATUS_CHANGE: '🔄', NOTE: '📝',
  PAYMENT: '💳', INCIDENT: '⚠️', DOCUMENT: '📄', EXTERNAL_SIGNAL: '📡', RISK_SCORE_CHANGE: '📊',
}

const VALID_STATUSES: ReviewStatus[] = ['SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE','CANCELLED']

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDateGroup(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function scoreColor(s: number | null) {
  if (s === null) return 'var(--muted)'
  return s >= 7 ? '#16a34a' : s >= 4 ? '#ea580c' : '#dc2626'
}

function objToKV(obj: Record<string, string>): FindingsKV {
  return Object.entries(obj ?? {}).map(([key, value]) => ({ key, value }))
}

function kvToObj(rows: FindingsKV): Record<string, string> {
  return Object.fromEntries(rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]))
}

function FindingsEditor({
  domain, rows, onChange,
}: {
  domain: string
  rows: FindingsKV
  onChange: (rows: FindingsKV) => void
}) {
  const inputStyle = {
    border: '1px solid var(--border)', color: 'var(--ink)',
    background: 'var(--surface)', outline: 'none',
  }
  return (
    <div className="rounded-xl p-4" style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold capitalize" style={{ color: 'var(--ink)' }}>{domain} Findings</h4>
        <button
          type="button"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
          className="text-xs px-2 py-1 rounded-lg"
          style={{ background: '#eff6ff', color: '#2563eb', border: 'none', cursor: 'pointer' }}
        >
          + Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>No findings recorded.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={row.key}
                onChange={e => {
                  const next = [...rows]; next[i] = { ...row, key: e.target.value }; onChange(next)
                }}
                placeholder="Finding name"
                className="px-2 py-1.5 rounded-lg text-xs"
                style={{ ...inputStyle, width: '35%' }}
              />
              <input
                value={row.value}
                onChange={e => {
                  const next = [...rows]; next[i] = { ...row, value: e.target.value }; onChange(next)
                }}
                placeholder="Description"
                className="flex-1 px-2 py-1.5 rounded-lg text-xs"
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="px-2 py-1.5 rounded-lg text-xs"
                style={{ color: '#dc2626', background: '#fef2f2', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ReviewDetailPage() {
  const user   = useUser()
  const params = useParams()
  const id     = params.id as string

  const [review,          setReview]          = useState<ReviewDetail | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState<string | null>(null)
  const [saving,          setSaving]          = useState(false)
  const [saved,           setSaved]           = useState(false)
  const [tab,             setTab]             = useState<'overview' | 'history'>('overview')
  const [activityLogs,    setActivityLogs]    = useState<ActivityLog[]>([])
  const [activityLoaded,  setActivityLoaded]  = useState(false)
  const [activityLoading, setActivityLoading] = useState(false)

  // Edit state — always visible for authorised users, no separate toggle
  const [editStatus,       setEditStatus]       = useState<ReviewStatus>('IN_PROGRESS')
  const [editOverall,      setEditOverall]      = useState('')
  const [editCyber,        setEditCyber]        = useState('')
  const [editLegal,        setEditLegal]        = useState('')
  const [editPrivacy,      setEditPrivacy]      = useState('')
  const [editNotes,        setEditNotes]        = useState('')
  const [editScheduled,    setEditScheduled]    = useState('')
  const [editNextReview,   setEditNextReview]   = useState('')
  const [cyberKV,          setCyberKV]          = useState<FindingsKV>([])
  const [legalKV,          setLegalKV]          = useState<FindingsKV>([])
  const [privacyKV,        setPrivacyKV]        = useState<FindingsKV>([])

  const populateEdit = (r: ReviewDetail) => {
    setEditStatus(r.status)
    setEditOverall(r.overallScore?.toString()  ?? '')
    setEditCyber(r.cyberScore?.toString()      ?? '')
    setEditLegal(r.legalScore?.toString()      ?? '')
    setEditPrivacy(r.privacyScore?.toString()  ?? '')
    setEditNotes(r.notes ?? '')
    setEditScheduled(r.scheduledAt?.split('T')[0]    ?? '')
    setEditNextReview(r.nextReviewDate?.split('T')[0] ?? '')
    setCyberKV(objToKV(r.cyberFindings))
    setLegalKV(objToKV(r.legalFindings))
    setPrivacyKV(objToKV(r.privacyFindings))
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reviews/${id}`)
      if (!res.ok) throw new Error('Not found')
      const data: ReviewDetail = await res.json()
      setReview(data)
      populateEdit(data)
    } catch {
      setError('Review not found.')
    } finally {
      setLoading(false)
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // Lazy-load activity logs when History tab is opened
  useEffect(() => {
    if (tab !== 'history' || activityLoaded || !review?.entity?.id) return
    setActivityLoading(true)
    fetch(`/api/entities/${review.entity.id}`)
      .then(r => r.json())
      .then(d => {
        const logs: ActivityLog[] = (d.entity?.entityActivityLogs ?? [])
          .filter((l: ActivityLog) => l.activityType === 'REVIEW')
        setActivityLogs(logs)
        setActivityLoaded(true)
      })
      .catch(() => { setActivityLoaded(true) })
      .finally(() => setActivityLoading(false))
  }, [tab, review?.entity?.id, activityLoaded])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/reviews/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:          editStatus,
          overallScore:    editOverall  !== '' ? Number(editOverall)  : null,
          cyberScore:      editCyber    !== '' ? Number(editCyber)    : null,
          legalScore:      editLegal    !== '' ? Number(editLegal)    : null,
          privacyScore:    editPrivacy  !== '' ? Number(editPrivacy)  : null,
          cyberFindings:   kvToObj(cyberKV),
          legalFindings:   kvToObj(legalKV),
          privacyFindings: kvToObj(privacyKV),
          notes:           editNotes    || null,
          scheduledAt:     editScheduled   || null,
          nextReviewDate:  editNextReview  || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error?.message ?? 'Failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      // Invalidate activity logs so they reload on next History visit
      setActivityLoaded(false)
      setActivityLogs([])
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (!review) return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error ?? 'Not found'}</div>

  const col      = STATUS_COLOR[review.status]
  const canWrite = WRITE_ROLES.has(user.role ?? '')
  const inputStyle = {
    border: '1px solid var(--border)', color: 'var(--ink)',
    background: 'var(--surface)', outline: 'none',
  }

  // Group activity logs by date label
  const grouped = activityLogs.reduce<Record<string, ActivityLog[]>>((acc, log) => {
    const g = fmtDateGroup(log.occurredAt)
    if (!acc[g]) acc[g] = []
    acc[g].push(log)
    return acc
  }, {})

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--muted)' }}>
        <Link href="/dashboard/reviews" className="hover:underline">Reviews</Link>
        <span>/</span>
        <span style={{ color: 'var(--ink)' }}>{review.entity?.name ?? id}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          {review.entity ? (
            <Link href={`/dashboard/entities/${review.entity.id}`}
              className="text-2xl font-semibold hover:underline" style={{ color: 'var(--ink)' }}>
              {review.entity.name}
            </Link>
          ) : (
            <span className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>{id}</span>
          )}
          <span className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: col.bg, color: col.text }}>
            {review.status.replace(/_/g, ' ')}
          </span>
          <span className="px-2 py-0.5 rounded-full text-xs"
            style={{ background: '#f1f5f9', color: '#64748b' }}>
            {review.reviewType.replace(/_/g, ' ')}
          </span>
          {review.entity?.riskScores?.[0] && (
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-medium"
              style={{ background: '#f8fafc', color: scoreColor(review.entity.riskScores[0].computedScore), border: '1px solid var(--border)' }}>
              Risk {review.entity.riskScores[0].computedScore.toFixed(1)}
            </span>
          )}
        </div>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Initiated {fmtDate(review.createdAt)}
          {review.reviewer && ` · ${review.reviewer.name ?? review.reviewer.email}`}
          {review.approver && ` · Approved by ${review.approver.name ?? review.approver.email}`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--border)' }}>
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'history',  label: 'History'  },
        ] as const).map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{
              color:        tab === t.key ? '#2563eb' : 'var(--muted)',
              fontWeight:   tab === t.key ? 600 : 400,
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              borderBottom: tab === t.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer', padding: '8px 16px', fontSize: 14, marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-5">

            {/* Score cards */}
            <div className="grid grid-cols-4 gap-3">
              {([
                { label: 'Overall', score: review.overallScore },
                { label: 'Cyber',   score: review.cyberScore },
                { label: 'Legal',   score: review.legalScore },
                { label: 'Privacy', score: review.privacyScore },
              ] as const).map(({ label, score }) => (
                <div key={label} className="rounded-2xl p-4 text-center"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="text-2xl font-bold" style={{ color: scoreColor(score) }}>
                    {score !== null ? score.toFixed(1) : '—'}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Findings read-only */}
            {(['cyber','legal','privacy'] as const).map(domain => {
              const findings = review[`${domain}Findings`] as Record<string, string>
              const keys = Object.keys(findings ?? {})
              if (keys.length === 0) return null
              return (
                <div key={domain} className="rounded-2xl p-5"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <h3 className="text-sm font-semibold mb-3 capitalize" style={{ color: 'var(--ink)' }}>
                    {domain} Findings
                  </h3>
                  <dl className="space-y-2">
                    {keys.map(k => (
                      <div key={k} className="grid gap-1" style={{ gridTemplateColumns: '1fr 2fr' }}>
                        <dt className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{k}</dt>
                        <dd className="text-sm" style={{ color: 'var(--ink)' }}>{findings[k]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            })}

            {review.notes && (
              <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Notes</h3>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{review.notes}</p>
              </div>
            )}

            {/* Edit form */}
            {canWrite && (
              <div className="rounded-2xl p-5 space-y-4"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Update Review</h2>

                {/* Status */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Status</label>
                  <select value={editStatus}
                    onChange={e => setEditStatus(e.target.value as ReviewStatus)}
                    className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}>
                    {VALID_STATUSES.map(s => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>

                {/* Scores */}
                <div className="grid grid-cols-2 gap-4">
                  {([
                    ['Overall Score (0–10)', editOverall,  setEditOverall],
                    ['Cyber Score (0–10)',   editCyber,    setEditCyber],
                    ['Legal Score (0–10)',   editLegal,    setEditLegal],
                    ['Privacy Score (0–10)', editPrivacy,  setEditPrivacy],
                  ] as [string, string, (v: string) => void][]).map(([label, val, set]) => (
                    <div key={label}>
                      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>{label}</label>
                      <input type="number" min="0" max="10" step="0.1"
                        value={val} onChange={e => set(e.target.value)}
                        placeholder="0–10"
                        className="w-full px-3 py-2 rounded-xl text-sm"
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>

                {/* Findings editors */}
                <FindingsEditor domain="Cyber"   rows={cyberKV}   onChange={setCyberKV} />
                <FindingsEditor domain="Legal"   rows={legalKV}   onChange={setLegalKV} />
                <FindingsEditor domain="Privacy" rows={privacyKV} onChange={setPrivacyKV} />

                {/* Notes */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Notes</label>
                  <textarea rows={3} value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm resize-none"
                    style={inputStyle}
                  />
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Scheduled Date</label>
                    <input type="date" value={editScheduled}
                      onChange={e => setEditScheduled(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Next Review Date</label>
                    <input type="date" value={editNextReview}
                      onChange={e => setEditNextReview(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}
                    />
                  </div>
                </div>

                {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}

                <button type="button" onClick={save} disabled={saving}
                  className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                  style={{
                    background: saved ? '#16a34a' : '#2563eb',
                    color: '#fff',
                  }}>
                  {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Review Details
              </h3>
              <dl className="space-y-3">
                {([
                  ['Type',         review.reviewType.replace(/_/g, ' ')],
                  ['Scheduled',    fmtDate(review.scheduledAt)],
                  ['Completed',    fmtDate(review.completedAt)],
                  ['Next Review',  fmtDate(review.nextReviewDate)],
                  ['Reviewer',     review.reviewer?.name ?? review.reviewer?.email ?? '—'],
                  ['Approved by',  review.approver?.name ?? review.approver?.email ?? '—'],
                  ['Last updated', fmtDate(review.updatedAt)],
                  ...(review.triggerEvent ? [['Trigger', review.triggerEvent]] : []),
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs" style={{ color: 'var(--muted)' }}>{k}</dt>
                    <dd className="text-xs font-medium mt-0.5" style={{ color: 'var(--ink)' }}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {review.entity && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  Entity
                </h3>
                <Link href={`/dashboard/entities/${review.entity.id}`}
                  className="text-sm font-medium hover:underline" style={{ color: '#2563eb' }}>
                  {review.entity.name}
                </Link>
                {review.entity.riskScores?.[0] && (
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    Risk:{' '}
                    <span style={{ color: scoreColor(review.entity.riskScores[0].computedScore), fontWeight: 600 }}>
                      {review.entity.riskScores[0].computedScore.toFixed(1)}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── History Tab ── */}
      {tab === 'history' && (
        <div className="max-w-2xl">
          {activityLoading ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading history…</p>
          ) : activityLogs.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--muted)' }}>
              <p className="text-sm">No review activity recorded for this entity yet.</p>
              <p className="text-xs mt-1">Activity will appear here after review updates are saved.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(grouped).map(([date, logs]) => (
                <div key={date}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3"
                    style={{ color: 'var(--muted)' }}>
                    {date}
                  </p>
                  <div className="space-y-2">
                    {logs.map(log => (
                      <div key={log.id} className="flex gap-3 items-start px-4 py-3 rounded-xl"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <span className="text-base mt-0.5 select-none">
                          {ACTIVITY_ICON[log.activityType] ?? '•'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{log.title}</p>
                            <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                              {fmtTime(log.occurredAt)}
                            </span>
                          </div>
                          {log.description && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{log.description}</p>
                          )}
                          {log.performedBy && (
                            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{log.performedBy}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
