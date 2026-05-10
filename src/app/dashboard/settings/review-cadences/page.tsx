'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReviewCadence {
  id:                 string
  name:               string
  riskScoreMin:       number
  riskScoreMax:       number
  reviewIntervalDays: number
  isActive:           boolean
  updatedAt:          string
}

// ─── Band config ─────────────────────────────────────────────────────────────

interface BandConfig {
  band:        'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  label:       string
  bg:          string
  text:        string
  defaultDays: number
  scoreMin:    number
  scoreMax:    number
}

const BANDS: BandConfig[] = [
  { band: 'LOW',      label: 'Low',      bg: '#f0fdf4', text: '#16a34a', defaultDays: 365, scoreMin: 0, scoreMax: 3  },
  { band: 'MEDIUM',   label: 'Medium',   bg: '#fff7ed', text: '#ea580c', defaultDays: 180, scoreMin: 3, scoreMax: 6  },
  { band: 'HIGH',     label: 'High',     bg: '#fef2f2', text: '#dc2626', defaultDays: 90,  scoreMin: 6, scoreMax: 8  },
  { band: 'CRITICAL', label: 'Critical', bg: '#450a0a', text: '#fca5a5', defaultDays: 30,  scoreMin: 8, scoreMax: 10 },
]

// Match cadences to bands by midpoint of score range
function midpoint(c: ReviewCadence) {
  return (c.riskScoreMin + c.riskScoreMax) / 2
}

function cadenceForBand(cadences: ReviewCadence[], band: BandConfig): ReviewCadence | undefined {
  return cadences.find(c => {
    const mid = midpoint(c)
    return mid > band.scoreMin && mid <= band.scoreMax
  }) ?? cadences.find(c => c.riskScoreMin === band.scoreMin && c.riskScoreMax === band.scoreMax)
}

// ─── Roles ───────────────────────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CFO', 'CONTROLLER'])

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReviewCadencesPage() {
  const user         = useUser()
  const queryClient  = useQueryClient()
  const canWrite     = WRITE_ROLES.has(user.role ?? '')

  // editing[band] = current input value while editing
  const [editing,  setEditing]  = useState<Partial<Record<string, string>>>({})
  const [saving,   setSaving]   = useState<Partial<Record<string, boolean>>>({})
  const [saveErr,  setSaveErr]  = useState<Partial<Record<string, string>>>({})
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.reviewCadences.all,
    queryFn:  async () => {
      const res = await fetch('/api/review-cadences')
      if (!res.ok) throw new Error('Failed to load cadences')
      const d = await res.json()
      return d.cadences as ReviewCadence[]
    },
  })

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  function startEdit(band: string, currentDays: number) {
    if (!canWrite) return
    setEditing(prev => ({ ...prev, [band]: String(currentDays) }))
    setSaveErr(prev => ({ ...prev, [band]: '' }))
    // Focus after render
    setTimeout(() => inputRefs.current[band]?.focus(), 0)
  }

  async function commitEdit(band: BandConfig, existingCadence: ReviewCadence | undefined) {
    const raw = editing[band.band]
    if (raw === undefined) return

    const days = parseInt(raw, 10)
    if (isNaN(days) || days < 1) {
      setSaveErr(prev => ({ ...prev, [band.band]: 'Must be a positive number.' }))
      return
    }

    // If value unchanged, just exit edit mode
    const currentDays = existingCadence?.reviewIntervalDays ?? band.defaultDays
    if (days === currentDays) {
      setEditing(prev => { const n = { ...prev }; delete n[band.band]; return n })
      return
    }

    setSaving(prev => ({ ...prev, [band.band]: true }))
    setSaveErr(prev => ({ ...prev, [band.band]: '' }))

    try {
      if (existingCadence) {
        // PUT to update existing
        const res = await apiClient(`/api/review-cadences/${existingCadence.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviewIntervalDays: days }),
        })
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error?.message ?? 'Save failed')
        }
      } else {
        // POST to create
        const res = await apiClient('/api/review-cadences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name:               `${band.label} Risk Cadence`,
            reviewIntervalDays: days,
            riskScoreMin:       band.scoreMin,
            riskScoreMax:       band.scoreMax,
            domains:            ['CYBERSECURITY'],
            isActive:           true,
          }),
        })
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error?.message ?? 'Save failed')
        }
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.reviewCadences.all })
      setEditing(prev => { const n = { ...prev }; delete n[band.band]; return n })
    } catch (e) {
      setSaveErr(prev => ({
        ...prev,
        [band.band]: e instanceof Error ? e.message : 'Save failed',
      }))
    } finally {
      setSaving(prev => ({ ...prev, [band.band]: false }))
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, band: BandConfig, existing: ReviewCadence | undefined) {
    if (e.key === 'Enter')  commitEdit(band, existing)
    if (e.key === 'Escape') setEditing(prev => { const n = { ...prev }; delete n[band.band]; return n })
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  const cadences = data ?? []

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Review Cadences</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Configure how frequently third-party reviews are required for each risk band.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          Could not load cadence settings.
        </div>
      )}

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                {['Risk Band', 'Review Frequency', 'Last Updated', canWrite ? 'Action' : ''].filter(Boolean).map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wide"
                    style={{ color: 'var(--muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BANDS.map((band, i) => {
                const existing   = cadenceForBand(cadences, band)
                const days       = existing?.reviewIntervalDays ?? band.defaultDays
                const isEditing  = editing[band.band] !== undefined
                const isSaving   = saving[band.band] ?? false
                const errMsg     = saveErr[band.band] ?? ''
                const isDefault  = !existing

                return (
                  <tr key={band.band}
                    style={{ borderBottom: i < BANDS.length - 1 ? '1px solid var(--border)' : undefined }}>

                    {/* Band badge */}
                    <td className="px-5 py-4">
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ background: band.bg, color: band.text }}>
                        {band.label}
                      </span>
                      {isDefault && (
                        <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>
                          (default)
                        </span>
                      )}
                    </td>

                    {/* Frequency */}
                    <td className="px-5 py-4">
                      {isEditing ? (
                        <div>
                          <div className="flex items-center gap-2">
                            <input
                              ref={el => { inputRefs.current[band.band] = el }}
                              type="number"
                              min={1}
                              value={editing[band.band]}
                              onChange={e => setEditing(prev => ({ ...prev, [band.band]: e.target.value }))}
                              onBlur={() => commitEdit(band, existing)}
                              onKeyDown={e => handleKeyDown(e, band, existing)}
                              disabled={isSaving}
                              className="w-24 px-2 py-1 rounded-lg text-sm"
                              style={{
                                border:   '1px solid #2563eb',
                                outline:  'none',
                                color:    'var(--ink)',
                                background: 'var(--bg)',
                              }}
                            />
                            <span className="text-xs" style={{ color: 'var(--muted)' }}>days</span>
                            {isSaving && (
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>Saving…</span>
                            )}
                          </div>
                          {errMsg && (
                            <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{errMsg}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {canWrite ? (
                            <button
                              type="button"
                              onClick={() => startEdit(band.band, days)}
                              className="text-sm font-medium hover:underline"
                              style={{ color: 'var(--ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                              title="Click to edit"
                            >
                              {days}
                            </button>
                          ) : (
                            <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{days}</span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>days</span>
                        </div>
                      )}
                    </td>

                    {/* Last updated */}
                    <td className="px-5 py-4 text-xs" style={{ color: 'var(--muted)' }}>
                      {existing ? fmtDate(existing.updatedAt) : '—'}
                    </td>

                    {/* Action */}
                    {canWrite && (
                      <td className="px-5 py-4">
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => startEdit(band.band, days)}
                            className="text-xs px-3 py-1.5 rounded-xl transition-colors"
                            style={{
                              border:     '1px solid var(--border)',
                              color:      'var(--muted)',
                              background: 'var(--surface)',
                              cursor:     'pointer',
                            }}
                          >
                            {isDefault ? 'Add' : 'Edit'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>
        Click a frequency number or the Edit button to update it inline.
        Press Enter to save or Escape to cancel.
      </p>
    </div>
  )
}
