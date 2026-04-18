'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'
import Link from 'next/link'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

interface WorkloadRow {
  userId:                  string
  pendingApprovals:        number
  pendingAmendmentReviews: number
  overdueReviews:          number
  totalWorkload:           number
}

interface ApiResponse {
  workload: WorkloadRow[]
  isLive:   boolean
}

function WorkloadBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const color = pct >= 75 ? '#dc2626' : pct >= 40 ? '#d97706' : '#2563eb'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-sm tabular-nums" style={{ color: 'var(--ink)', fontWeight: 500 }}>
        {value}
      </span>
    </div>
  )
}

export default function WorkloadPage() {
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
    fetch('/api/reports/workload')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [role, router])

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>
  if (!data)   return null

  // Already sorted by totalWorkload DESC from the API query
  const rows = data.workload
  const maxWorkload = rows.reduce((m, r) => Math.max(m, r.totalWorkload), 0)

  const th = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-4 py-3 text-sm'

  return (
    <div className="p-8 max-w-4xl space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--muted)' }}>
            <Link href="/dashboard/reports" style={{ color: 'var(--muted)' }}>Reports</Link>
            <span>/</span>
            <span>Workload Analysis</span>
          </div>
          <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>
            Workload Analysis
          </h1>
        </div>
        <div className="flex items-center gap-3 self-end">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: data.isLive ? '#f0fdf4' : '#eff6ff',
              color:      data.isLive ? '#16a34a' : '#2563eb',
              border:     data.isLive ? '1px solid #16a34a22' : '1px solid #2563eb22',
            }}>
            {data.isLive ? 'Live' : 'Snapshot'}
          </span>
          <a href="/api/reports/export?report=workload&format=csv"
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
            Export CSV
          </a>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No active workload items.</p>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full">
            <thead style={{ background: 'var(--surface)' }}>
              <tr>
                {['User', 'Pending Approvals', 'Amendment Reviews', 'Overdue Reviews', 'Total Workload'].map(h => (
                  <th key={h} className={th}
                    style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.userId}
                  style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                  <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                    <span className="font-mono text-xs px-2 py-0.5 rounded"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                      {row.userId.slice(0, 8)}…
                    </span>
                  </td>
                  <td className={`${td} tabular-nums`} style={{ color: row.pendingApprovals > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                    {row.pendingApprovals}
                  </td>
                  <td className={`${td} tabular-nums`} style={{ color: row.pendingAmendmentReviews > 0 ? '#d97706' : 'var(--muted)' }}>
                    {row.pendingAmendmentReviews}
                  </td>
                  <td className={`${td} tabular-nums`} style={{ color: row.overdueReviews > 0 ? '#dc2626' : 'var(--muted)' }}>
                    {row.overdueReviews}
                  </td>
                  <td className={td}>
                    <WorkloadBar value={row.totalWorkload} max={maxWorkload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Sorted by total workload descending. Workload bar is relative to the highest-loaded team member.
      </p>
    </div>
  )
}
