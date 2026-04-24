'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

type ReviewStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
type ReviewType   = 'ONBOARDING' | 'PERIODIC' | 'EVENT_TRIGGERED'

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
  entity:  { id: string; name: string; riskScores: { computedScore: number }[] } | null
  reviewer:{ id: string; name: string | null; email: string } | null
  approver:{ id: string; name: string | null; email: string } | null
}

const STATUS_COLOR: Record<ReviewStatus, { bg: string; text: string }> = {
  SCHEDULED:   { bg: '#eff6ff', text: '#2563eb' },
  IN_PROGRESS: { bg: '#fff7ed', text: '#ea580c' },
  COMPLETED:   { bg: '#f0fdf4', text: '#16a34a' },
  OVERDUE:     { bg: '#fef2f2', text: '#dc2626' },
  CANCELLED:   { bg: '#f8fafc', text: '#64748b' },
}

const VALID_STATUSES: ReviewStatus[] = ['SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE','CANCELLED']
const DOMAINS = ['cyber','legal','privacy'] as const

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ScoreInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>{label}</label>
      <input type="number" min="0" max="10" step="0.1"
        value={value} onChange={e => onChange(e.target.value)}
        placeholder="0–10"
        className="w-full px-3 py-2 rounded-xl text-sm"
        style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }}
      />
    </div>
  )
}

export default function ReviewDetailPage() {
  const user   = useUser()
  const params = useParams()
  const id     = params.id as string

  const [review,   setReview]   = useState<ReviewDetail | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [editing,  setEditing]  = useState(false)
  const [saving,   setSaving]   = useState(false)

  const [editData, setEditData] = useState<{
    status:          ReviewStatus
    cyberScore:      string
    legalScore:      string
    privacyScore:    string
    overallScore:    string
    cyberFindings:   string
    legalFindings:   string
    privacyFindings: string
    notes:           string
    nextReviewDate:  string
  }>({
    status: 'IN_PROGRESS', cyberScore: '', legalScore: '', privacyScore: '',
    overallScore: '', cyberFindings: '', legalFindings: '', privacyFindings: '',
    notes: '', nextReviewDate: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reviews/${id}`)
      if (!res.ok) throw new Error('Not found')
      const data = await res.json()
      setReview(data)
    } catch {
      setError('Review not found.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function startEdit() {
    if (!review) return
    setEditData({
      status:          review.status,
      cyberScore:      review.cyberScore?.toString()    ?? '',
      legalScore:      review.legalScore?.toString()    ?? '',
      privacyScore:    review.privacyScore?.toString()  ?? '',
      overallScore:    review.overallScore?.toString()  ?? '',
      cyberFindings:   typeof review.cyberFindings    === 'object' ? JSON.stringify(review.cyberFindings,    null, 2) : '{}',
      legalFindings:   typeof review.legalFindings    === 'object' ? JSON.stringify(review.legalFindings,    null, 2) : '{}',
      privacyFindings: typeof review.privacyFindings  === 'object' ? JSON.stringify(review.privacyFindings,  null, 2) : '{}',
      notes:           review.notes ?? '',
      nextReviewDate:  review.nextReviewDate?.split('T')[0] ?? '',
    })
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError(null)
    let cyberF: unknown = {}, legalF: unknown = {}, privF: unknown = {}
    try {
      cyberF = JSON.parse(editData.cyberFindings    || '{}')
      legalF = JSON.parse(editData.legalFindings    || '{}')
      privF  = JSON.parse(editData.privacyFindings  || '{}')
    } catch {
      setError('Findings must be valid JSON')
      setSaving(false)
      return
    }
    try {
      const res = await fetch(`/api/reviews/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:          editData.status,
          cyberScore:      editData.cyberScore    !== '' ? Number(editData.cyberScore)    : null,
          legalScore:      editData.legalScore    !== '' ? Number(editData.legalScore)    : null,
          privacyScore:    editData.privacyScore  !== '' ? Number(editData.privacyScore)  : null,
          overallScore:    editData.overallScore  !== '' ? Number(editData.overallScore)  : null,
          cyberFindings:   cyberF,
          legalFindings:   legalF,
          privacyFindings: privF,
          notes:           editData.notes || null,
          nextReviewDate:  editData.nextReviewDate || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error?.message ?? 'Failed')
      }
      setEditing(false)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error || !review) return <div className="p-8 text-sm" style={{ color: '#dc2626' }}>{error ?? 'Not found'}</div>

  const col = STATUS_COLOR[review.status]
  const canWrite = WRITE_ROLES.has(user.role ?? '')
  const inputStyle = { border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }

  function scoreColor(s: number | null) {
    if (s === null) return 'var(--muted)'
    return s >= 7 ? '#16a34a' : s >= 4 ? '#ea580c' : '#dc2626'
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-4" style={{ color: 'var(--muted)' }}>
        <Link href="/dashboard/reviews" className="hover:underline">Reviews</Link>
        <span>/</span>
        <span style={{ color: 'var(--ink)' }}>{review.entity?.name ?? id}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {review.entity && (
              <Link href={`/dashboard/entities/${review.entity.id}`}
                className="text-2xl font-semibold hover:underline" style={{ color: 'var(--ink)' }}>
                {review.entity.name}
              </Link>
            )}
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: col.bg, color: col.text }}>
              {review.status.replace('_',' ')}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs"
              style={{ background: '#f1f5f9', color: '#64748b' }}>
              {review.reviewType.replace('_',' ')}
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Initiated {fmtDate(review.createdAt)}
            {review.reviewer && ` by ${review.reviewer.name ?? review.reviewer.email}`}
          </p>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit}
            className="px-4 py-2 rounded-xl text-sm"
            style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
            Update Findings
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">

          {/* Scores */}
          {editing ? (
            <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>Scores & Findings</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Status</label>
                  <select value={editData.status} onChange={e => setEditData(d => ({ ...d, status: e.target.value as ReviewStatus }))}
                    className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}>
                    {VALID_STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <ScoreInput label="Cyber Score (0–10)"   value={editData.cyberScore}   onChange={v => setEditData(d => ({ ...d, cyberScore: v }))} />
                  <ScoreInput label="Legal Score (0–10)"   value={editData.legalScore}   onChange={v => setEditData(d => ({ ...d, legalScore: v }))} />
                  <ScoreInput label="Privacy Score (0–10)" value={editData.privacyScore} onChange={v => setEditData(d => ({ ...d, privacyScore: v }))} />
                  <ScoreInput label="Overall Score (0–10)" value={editData.overallScore} onChange={v => setEditData(d => ({ ...d, overallScore: v }))} />
                </div>

                {DOMAINS.map(domain => (
                  <div key={domain}>
                    <label className="text-xs font-medium block mb-1 capitalize" style={{ color: 'var(--ink)' }}>
                      {domain} Findings (JSON)
                    </label>
                    <textarea rows={3}
                      value={editData[`${domain}Findings`]}
                      onChange={e => setEditData(d => ({ ...d, [`${domain}Findings`]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono resize-none"
                      style={inputStyle}
                      placeholder='{"finding": "description"}'
                    />
                  </div>
                ))}

                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Notes</label>
                  <textarea rows={3} value={editData.notes}
                    onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl text-sm resize-none" style={inputStyle}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: 'var(--ink)' }}>Next Review Date</label>
                  <input type="date" value={editData.nextReviewDate}
                    onChange={e => setEditData(d => ({ ...d, nextReviewDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl text-sm" style={inputStyle}
                  />
                </div>

                {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(false); setError(null) }}
                    className="px-4 py-2 rounded-xl text-sm"
                    style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                    Cancel
                  </button>
                  <button onClick={save} disabled={saving}
                    className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                    style={{ background: '#2563eb', color: '#fff' }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Score cards */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Overall',  score: review.overallScore },
                  { label: 'Cyber',    score: review.cyberScore },
                  { label: 'Legal',    score: review.legalScore },
                  { label: 'Privacy',  score: review.privacyScore },
                ].map(({ label, score }) => (
                  <div key={label} className="rounded-2xl p-4 text-center"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="text-2xl font-bold" style={{ color: scoreColor(score) }}>
                      {score !== null ? score.toFixed(1) : '—'}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Findings */}
              {DOMAINS.map(domain => {
                const findings = review[`${domain}Findings`] as Record<string, string>
                const keys = Object.keys(findings ?? {})
                if (keys.length === 0) return null
                return (
                  <div key={domain} className="rounded-2xl p-5"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <h2 className="text-sm font-semibold mb-3 capitalize" style={{ color: 'var(--ink)' }}>
                      {domain} Findings
                    </h2>
                    <dl className="space-y-2">
                      {keys.map(k => (
                        <div key={k}>
                          <dt className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{k}</dt>
                          <dd className="text-sm" style={{ color: 'var(--ink)' }}>{findings[k]}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )
              })}

              {/* Notes */}
              {review.notes && (
                <div className="rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Notes</h2>
                  <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{review.notes}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Review Details
            </h3>
            <dl className="space-y-2 text-xs">
              {[
                ['Type',          review.reviewType.replace('_',' ')],
                ['Scheduled',     fmtDate(review.scheduledAt)],
                ['Completed',     fmtDate(review.completedAt)],
                ['Next Review',   fmtDate(review.nextReviewDate)],
                ['Reviewer',      review.reviewer?.name ?? review.reviewer?.email ?? '—'],
                ['Approved by',   review.approver?.name ?? review.approver?.email ?? '—'],
                ...(review.triggerEvent ? [['Trigger', review.triggerEvent]] : []),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt style={{ color: 'var(--muted)' }}>{k}</dt>
                  <dd style={{ color: 'var(--ink)' }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {review.entity && (
            <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Entity</h3>
              <Link href={`/dashboard/entities/${review.entity.id}`}
                className="text-sm font-medium hover:underline" style={{ color: '#2563eb' }}>
                {review.entity.name}
              </Link>
              {review.entity.riskScores?.[0] && (
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Risk score: <span style={{ color: scoreColor(review.entity.riskScores[0].computedScore), fontWeight: 600 }}>
                    {review.entity.riskScores[0].computedScore.toFixed(1)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
