'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'
import { apiClient } from '@/lib/api-client'

const ALLOWED_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])
const RUN_ROLES     = new Set(['ADMIN', 'CFO', 'CONTROLLER'])
const ADMIN_ROLES   = new Set(['ADMIN'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TestResultStatus = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_RUN' | 'ERROR'
type ControlDomain    = 'ACCESS_CONTROL' | 'CHANGE_MANAGEMENT' | 'FINANCIAL_INTEGRITY' | 'VENDOR_RISK' | 'BC_DR' | 'MONITORING'
type ControlFrequency = 'CONTINUOUS' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'PER_EVENT'

interface LatestResult {
  id:         string
  status:     TestResultStatus
  summary:    string
  testedAt:   string
  testedBy:   string
  reviewedBy: string | null
}

interface Control {
  id:               string
  controlId:        string
  domain:           ControlDomain
  title:            string
  frequency:        ControlFrequency
  sox:              boolean
  soc2Criteria:     string[]
  status:           string
  automatedTestKey: string | null
  latestResult:     LatestResult | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)  return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

const DOMAIN_TAB: Record<ControlDomain | 'ALL', string> = {
  ALL:                   'All',
  ACCESS_CONTROL:        'Access Control',
  CHANGE_MANAGEMENT:     'Change Management',
  FINANCIAL_INTEGRITY:   'Financial Integrity',
  VENDOR_RISK:           'Vendor Risk',
  BC_DR:                 'BC/DR',
  MONITORING:            'Monitoring',
}

const DOMAIN_COLOR: Record<ControlDomain, { bg: string; color: string; border: string }> = {
  ACCESS_CONTROL:      { bg: '#eff6ff', color: '#2563eb', border: '#2563eb22' },
  CHANGE_MANAGEMENT:   { bg: '#f5f3ff', color: '#7c3aed', border: '#7c3aed22' },
  FINANCIAL_INTEGRITY: { bg: '#fffbeb', color: '#d97706', border: '#d9770622' },
  VENDOR_RISK:         { bg: '#fff7ed', color: '#ea580c', border: '#ea580c22' },
  BC_DR:               { bg: '#ecfeff', color: '#0891b2', border: '#0891b222' },
  MONITORING:          { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22' },
}

const STATUS_COLOR: Record<TestResultStatus, { bg: string; color: string; border: string; label: string }> = {
  PASS:    { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Pass'    },
  FAIL:    { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Fail'    },
  WARNING: { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Warning' },
  NOT_RUN: { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Not run' },
  ERROR:   { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Error'   },
}

const FREQ_LABEL: Record<ControlFrequency, string> = {
  CONTINUOUS: 'Continuous',
  DAILY:      'Daily',
  WEEKLY:     'Weekly',
  MONTHLY:    'Monthly',
  QUARTERLY:  'Quarterly',
  PER_EVENT:  'Per event',
}

function StatusBadge({ status }: { status: TestResultStatus }) {
  const s = STATUS_COLOR[status] ?? STATUS_COLOR.NOT_RUN
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  )
}

function DomainBadge({ domain }: { domain: ControlDomain }) {
  const d = DOMAIN_COLOR[domain]
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: d.bg, color: d.color, border: `1px solid ${d.border}` }}>
      {DOMAIN_TAB[domain]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------
function summarise(controls: Control[]) {
  const counts = { pass: 0, fail: 0, warning: 0, notRun: 0, error: 0 }
  for (const c of controls) {
    const s = c.latestResult?.status
    if      (!s || s === 'NOT_RUN') counts.notRun++
    else if (s === 'PASS')          counts.pass++
    else if (s === 'FAIL')          counts.fail++
    else if (s === 'WARNING')       counts.warning++
    else if (s === 'ERROR')         counts.error++
  }
  return counts
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ControlsPage() {
  const { role }   = useUser()
  const router     = useRouter()

  const [controls,    setControls]    = useState<Control[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [activeTab,   setActiveTab]   = useState<ControlDomain | 'ALL'>('ALL')
  const [running,     setRunning]     = useState<Set<string>>(new Set())
  const [runningAll,  setRunningAll]  = useState(false)

  const canRun    = RUN_ROLES.has(role ?? '')
  const isAdmin   = ADMIN_ROLES.has(role ?? '')

  const fetchControls = useCallback(() => {
    setLoading(true)
    fetch('/api/controls')
      .then(r => r.json())
      .then((d: { controls: Control[] }) => setControls(d.controls ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!ALLOWED_ROLES.has(role ?? '')) { router.replace('/dashboard'); return }
    fetchControls()
  }, [role, router, fetchControls])

  async function runOne(controlId: string) {
    setRunning(prev => new Set([...prev, controlId]))
    try {
      await apiClient(`/api/controls/${controlId}/run`, { method: 'POST' })
      fetchControls()
    } finally {
      setRunning(prev => { const s = new Set(prev); s.delete(controlId); return s })
    }
  }

  async function runAll() {
    setRunningAll(true)
    try {
      await apiClient('/api/controls', { method: 'POST' })
      fetchControls()
    } finally {
      setRunningAll(false)
    }
  }

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>

  const counts  = summarise(controls)
  const visible = activeTab === 'ALL' ? controls : controls.filter(c => c.domain === activeTab)

  const th = 'px-3 py-3 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-3 py-3 text-sm'

  return (
    <div className="p-8 max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>Controls</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Automated control testing and evidence collection
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={runAll}
            disabled={runningAll}
            className="text-sm font-medium px-4 py-2 rounded-xl transition-opacity disabled:opacity-50"
            style={{ background: '#2563eb', color: '#fff', border: '1px solid #2563eb' }}>
            {runningAll ? 'Running…' : 'Run all controls'}
          </button>
        )}
      </div>

      {/* Summary row */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Total',    value: controls.length, bg: 'var(--surface)', color: 'var(--ink)',  border: 'var(--border)' },
          { label: 'Passing',  value: counts.pass,     bg: '#f0fdf4',        color: '#16a34a',     border: '#16a34a22'    },
          { label: 'Failing',  value: counts.fail + counts.error, bg: '#fef2f2', color: '#dc2626', border: '#dc262622'    },
          { label: 'Warnings', value: counts.warning,  bg: '#fffbeb',        color: '#d97706',     border: '#d9770622'    },
          { label: 'Not run',  value: counts.notRun,   bg: '#f9fafb',        color: '#6b7280',     border: '#6b728022'    },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
            <span className="text-xl font-display tabular-nums">{s.value}</span>
            <span className="text-xs">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Domain filter tabs */}
      <div className="flex flex-wrap gap-1">
        {(Object.keys(DOMAIN_TAB) as Array<ControlDomain | 'ALL'>).map(tab => {
          const active = activeTab === tab
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: active ? '#2563eb' : 'var(--surface)',
                color:      active ? '#fff'    : 'var(--muted)',
                border:     active ? '1px solid #2563eb' : '1px solid var(--border)',
              }}>
              {DOMAIN_TAB[tab]}
            </button>
          )
        })}
      </div>

      {/* Controls table */}
      <div className="rounded-2xl overflow-x-auto" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full min-w-[900px]">
          <thead style={{ background: 'var(--surface)' }}>
            <tr>
              {['ID', 'Title', 'Domain', 'Frequency', 'Last tested', 'Status', 'SOX', 'SOC2', ''].map(h => (
                <th key={h} className={th}
                  style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-sm text-center" style={{ color: 'var(--muted)' }}>
                  No controls found.
                </td>
              </tr>
            )}
            {visible.map((c, i) => {
              const isRunning = running.has(c.id)
              const resultStatus: TestResultStatus = c.latestResult?.status ?? 'NOT_RUN'
              return (
                <tr key={c.id} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>

                  {/* Control ID */}
                  <td className={td}>
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
                      {c.controlId}
                    </span>
                  </td>

                  {/* Title */}
                  <td className={td} style={{ color: 'var(--ink)', maxWidth: 220 }}>
                    <span className="font-medium">{c.title}</span>
                  </td>

                  {/* Domain */}
                  <td className={td}>
                    <DomainBadge domain={c.domain} />
                  </td>

                  {/* Frequency */}
                  <td className={td} style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {FREQ_LABEL[c.frequency]}
                  </td>

                  {/* Last tested */}
                  <td className={td} style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {c.latestResult ? relativeTime(c.latestResult.testedAt) : 'Never'}
                  </td>

                  {/* Status */}
                  <td className={td}>
                    {c.latestResult?.summary ? (
                      <span title={c.latestResult.summary}>
                        <StatusBadge status={resultStatus} />
                      </span>
                    ) : (
                      <StatusBadge status="NOT_RUN" />
                    )}
                  </td>

                  {/* SOX */}
                  <td className={td}>
                    {c.sox && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                        style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #92400e22' }}>
                        SOX
                      </span>
                    )}
                  </td>

                  {/* SOC2 */}
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {c.soc2Criteria.map(crit => (
                        <span key={crit} className="text-xs px-1.5 py-0.5 rounded font-mono"
                          style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #15803d22' }}>
                          {crit}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Run button */}
                  <td className={td}>
                    {canRun && c.automatedTestKey && (
                      <button
                        onClick={() => runOne(c.id)}
                        disabled={isRunning || runningAll}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg transition-opacity disabled:opacity-40"
                        style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
                        {isRunning ? 'Running…' : 'Run'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Hover the status badge to see the test summary. Click Run to execute a single control test.
      </p>
    </div>
  )
}
