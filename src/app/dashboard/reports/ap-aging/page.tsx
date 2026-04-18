'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface AgingRow {
  currency:     string
  current:      number
  days1to30:    number
  days31to60:   number
  days61to90:   number
  over90:       number
  total:        number
  invoiceCount: number
}

interface QueueRow {
  currency:             string
  pendingApproval:      number
  amendmentPending:     number
  approvedAwaitingSend: number
  sentToErp:            number
  dueToday:             number
  overdue:              number
  totalPendingAmount:   number
}

interface ApiResponse {
  apAging:     AgingRow[]
  paymentQueue: QueueRow[]
  isLive:      boolean
  snapshotAge?: number
}

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style:    'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function FreshnessTag({ isLive, snapshotAge }: { isLive: boolean; snapshotAge?: number }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        background: isLive ? '#f0fdf4' : '#eff6ff',
        color:      isLive ? '#16a34a' : '#2563eb',
        border:     isLive ? '1px solid #16a34a22' : '1px solid #2563eb22',
      }}>
      {isLive ? 'Live data' : `Snapshot from ${snapshotAge} min ago`}
    </span>
  )
}

export default function ApAgingPage() {
  const [data, setData]       = useState<ApiResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reports/ap-aging')
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>
  if (!data)   return null

  const th = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-4 py-3 text-sm tabular-nums'

  return (
    <div className="p-8 max-w-5xl space-y-10">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--muted)' }}>
            <Link href="/dashboard/reports" style={{ color: 'var(--muted)' }}>Reports</Link>
            <span>/</span>
            <span>AP Aging</span>
          </div>
          <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>
            AP Aging & Payment Queue
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <FreshnessTag isLive={data.isLive} snapshotAge={data.snapshotAge} />
          <a
            href="/api/reports/export?report=ap-aging&format=csv"
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* AP Aging Table */}
      <section>
        <h2 className="font-medium text-sm mb-3" style={{ color: 'var(--ink)' }}>
          AP Aging — by currency
        </h2>
        {data.apAging.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No outstanding invoices.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full">
              <thead style={{ background: 'var(--surface)' }}>
                <tr>
                  {['Currency', 'Current', '1–30 days', '31–60 days', '61–90 days', 'Over 90', 'Total', 'Invoices'].map(h => (
                    <th key={h} className={th} style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.apAging.map((row, i) => (
                  <tr key={row.currency}
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                    <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.currency}</td>
                    <td className={td} style={{ color: 'var(--ink)' }}>{fmt(row.current, row.currency)}</td>
                    <td className={td} style={{ color: row.days1to30  > 0 ? '#d97706' : 'var(--muted)' }}>{fmt(row.days1to30,  row.currency)}</td>
                    <td className={td} style={{ color: row.days31to60 > 0 ? '#d97706' : 'var(--muted)' }}>{fmt(row.days31to60, row.currency)}</td>
                    <td className={td} style={{ color: row.days61to90 > 0 ? '#dc2626' : 'var(--muted)' }}>{fmt(row.days61to90, row.currency)}</td>
                    <td className={td} style={{ color: row.over90     > 0 ? '#dc2626' : 'var(--muted)' }}>{fmt(row.over90,     row.currency)}</td>
                    <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(row.total, row.currency)}</td>
                    <td className={td} style={{ color: 'var(--muted)' }}>{row.invoiceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Payment Queue */}
      <section>
        <h2 className="font-medium text-sm mb-3" style={{ color: 'var(--ink)' }}>
          Payment Queue — live
        </h2>
        {data.paymentQueue.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No payment instructions.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full">
              <thead style={{ background: 'var(--surface)' }}>
                <tr>
                  {['Currency', 'Pending Approval', 'Amendment Pending', 'Approved', 'Sent to ERP', 'Due Today', 'Overdue', 'Total Pending'].map(h => (
                    <th key={h} className={th} style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.paymentQueue.map((row, i) => (
                  <tr key={row.currency}
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                    <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.currency}</td>
                    <td className={td} style={{ color: 'var(--muted)' }}>{row.pendingApproval}</td>
                    <td className={td} style={{ color: row.amendmentPending > 0 ? '#d97706' : 'var(--muted)' }}>{row.amendmentPending}</td>
                    <td className={td} style={{ color: 'var(--muted)' }}>{row.approvedAwaitingSend}</td>
                    <td className={td} style={{ color: 'var(--muted)' }}>{row.sentToErp}</td>
                    <td className={td} style={{ color: row.dueToday > 0 ? '#2563eb' : 'var(--muted)' }}>{row.dueToday}</td>
                    <td className={td} style={{ color: row.overdue > 0 ? '#dc2626' : 'var(--muted)' }}>{row.overdue}</td>
                    <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(row.totalPendingAmount, row.currency)}</td>
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
