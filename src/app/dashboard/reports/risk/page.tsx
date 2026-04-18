'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'
import Link from 'next/link'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

interface TopRiskEntity {
  entityId:       string
  name:           string
  riskScore:      number
  lastReviewDate: string | null
}

interface RiskData {
  highRiskCount:     number
  mediumRiskCount:   number
  lowRiskCount:      number
  overdueReviews:    number
  pendingOnboarding: number
  criticalSignals:   number
  topRiskEntities:   TopRiskEntity[]
}

interface ApiResponse {
  risk:        RiskData
  isLive:      boolean
  snapshotAge?: number
}

function ScoreBadge({ score }: { score: number }) {
  const color  = score >= 7 ? '#dc2626' : score >= 4 ? '#d97706' : '#16a34a'
  const bg     = score >= 7 ? '#fef2f2' : score >= 4 ? '#fffbeb' : '#f0fdf4'
  const border = score >= 7 ? '#dc262622' : score >= 4 ? '#d9770622' : '#16a34a22'
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full tabular-nums"
      style={{ background: bg, color, border: `1px solid ${border}` }}>
      {score.toFixed(1)}
    </span>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1"
      style={{ border: `1px solid ${accent && value > 0 ? '#dc262633' : 'var(--border)'}`, background: accent && value > 0 ? '#fef2f2' : 'var(--surface)' }}>
      <div className="text-2xl font-display tabular-nums"
        style={{ color: accent && value > 0 ? '#dc2626' : 'var(--ink)' }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  )
}

export default function RiskPage() {
  const { role }    = useUser()
  const router      = useRouter()
  const [data,    setData]    = useState<ApiResponse | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ALLOWED_ROLES.has(role ?? '')) {
      router.replace('/dashboard')
      return
    }
    fetch('/api/reports/risk')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [role, router])

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>
  if (!data)   return null

  const { risk } = data
  const th = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-4 py-3 text-sm'

  return (
    <div className="p-8 max-w-5xl space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--muted)' }}>
            <Link href="/dashboard/reports" style={{ color: 'var(--muted)' }}>Reports</Link>
            <span>/</span>
            <span>Risk Dashboard</span>
          </div>
          <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>
            Risk Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-3 self-end">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: data.isLive ? '#f0fdf4' : '#eff6ff',
              color:      data.isLive ? '#16a34a' : '#2563eb',
              border:     data.isLive ? '1px solid #16a34a22' : '1px solid #2563eb22',
            }}>
            {data.isLive ? 'Live' : `Snapshot ${data.snapshotAge}m ago`}
          </span>
          <a href="/api/reports/export?report=risk&format=csv"
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
            Export CSV
          </a>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="High Risk Entities"    value={risk.highRiskCount}     accent />
        <SummaryCard label="Medium Risk Entities"  value={risk.mediumRiskCount} />
        <SummaryCard label="Low Risk Entities"     value={risk.lowRiskCount} />
        <SummaryCard label="Overdue Reviews"       value={risk.overdueReviews}    accent />
        <SummaryCard label="Pending Onboarding"    value={risk.pendingOnboarding} />
        <SummaryCard label="Critical Signals"      value={risk.criticalSignals}   accent />
      </div>

      {/* Top risk entities table */}
      <section>
        <h2 className="font-medium text-sm mb-3" style={{ color: 'var(--ink)' }}>
          Top Risk Entities
        </h2>
        {risk.topRiskEntities.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No risk scores recorded yet.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full">
              <thead style={{ background: 'var(--surface)' }}>
                <tr>
                  {['Entity', 'Risk Score', 'Last Review Date'].map(h => (
                    <th key={h} className={th} style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {risk.topRiskEntities.map((entity, i) => (
                  <tr key={entity.entityId}
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                    <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>{entity.name}</td>
                    <td className={td}><ScoreBadge score={entity.riskScore} /></td>
                    <td className={td} style={{ color: 'var(--muted)' }}>
                      {entity.lastReviewDate
                        ? new Date(entity.lastReviewDate).toLocaleDateString()
                        : <span style={{ color: '#dc2626' }}>Never reviewed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
