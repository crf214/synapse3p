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

interface DetailRow {
  entityName:      string
  invoiceNo:       string
  invoiceDate:     string
  amount:          number
  currency:        string
  daysOutstanding: number
  ageBucket:       string
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
  detail:      DetailRow[]
  isLive:      boolean
  snapshotAge?: number
}

const BUCKETS = [
  { key: 'days1to30',  label: '0–30 days',  color: '#d97706', bg: '#fffbeb', border: '#d9770622' },
  { key: 'days31to60', label: '31–60 days', color: '#ea580c', bg: '#fff7ed', border: '#ea580c22' },
  { key: 'days61to90', label: '61–90 days', color: '#dc2626', bg: '#fef2f2', border: '#dc262622' },
  { key: 'over90',     label: '90+ days',   color: '#9f1239', bg: '#fff1f2', border: '#9f123922' },
] as const

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style:    'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function BucketBadge({ bucket }: { bucket: string }) {
  const cfg = BUCKETS.find(b => b.label === bucket)
  const color  = cfg?.color  ?? '#475569'
  const bg     = cfg?.bg     ?? '#f8fafc'
  const border = cfg?.border ?? 'transparent'
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: bg, color, border: `1px solid ${border}` }}>
      {bucket}
    </span>
  )
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
  const td = 'px-4 py-3 text-sm'

  // Compute bucket totals across all currencies for summary cards
  const bucketTotals = BUCKETS.map(b => ({
    ...b,
    total: data.apAging.reduce((sum, row) => sum + (row[b.key] as number), 0),
    currencies: [...new Set(data.apAging.map(r => r.currency))],
  }))

  return (
    <div className="p-8 max-w-6xl space-y-10">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
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
        <div className="flex items-center gap-3 self-end">
          <FreshnessTag isLive={data.isLive} snapshotAge={data.snapshotAge} />
          <a
            href="/api/reports/export?type=ap-aging&format=csv"
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Age bucket summary cards */}
      {data.apAging.length > 0 && (
        <section>
          <h2 className="font-medium text-sm mb-3" style={{ color: 'var(--ink)' }}>
            Outstanding by Age
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BUCKETS.map(b => {
              const rows = data.apAging.filter(r => (r[b.key] as number) > 0)
              return (
                <div key={b.key} className="rounded-2xl p-5"
                  style={{ border: `1px solid ${b.border}`, background: b.bg }}>
                  <div className="text-xs font-medium mb-2" style={{ color: b.color }}>{b.label}</div>
                  {rows.length === 0 ? (
                    <div className="text-lg font-display" style={{ color: 'var(--muted)' }}>—</div>
                  ) : (
                    <div className="space-y-0.5">
                      {rows.map(r => (
                        <div key={r.currency} className="text-lg font-display tabular-nums" style={{ color: b.color }}>
                          {fmt(r[b.key] as number, r.currency)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Per-invoice detail table */}
      <section>
        <h2 className="font-medium text-sm mb-3" style={{ color: 'var(--ink)' }}>
          Overdue Invoices
        </h2>
        {data.detail.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No overdue invoices.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full">
              <thead style={{ background: 'var(--surface)' }}>
                <tr>
                  {['Entity', 'Invoice Number', 'Invoice Date', 'Amount', 'Currency', 'Days Outstanding', 'Age Bucket'].map(h => (
                    <th key={h} className={th} style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.detail.map((row, i) => (
                  <tr key={`${row.invoiceNo}-${i}`}
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                    <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.entityName}</td>
                    <td className={`${td} font-mono text-xs`} style={{ color: 'var(--muted)' }}>{row.invoiceNo}</td>
                    <td className={td} style={{ color: 'var(--muted)' }}>{fmtDate(row.invoiceDate)}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--ink)' }}>
                      {fmt(row.amount, row.currency)}
                    </td>
                    <td className={td} style={{ color: 'var(--muted)' }}>{row.currency}</td>
                    <td className={`${td} tabular-nums font-medium`}
                      style={{ color: row.daysOutstanding > 90 ? '#9f1239' : row.daysOutstanding > 60 ? '#dc2626' : row.daysOutstanding > 30 ? '#ea580c' : '#d97706' }}>
                      {row.daysOutstanding}
                    </td>
                    <td className={td}><BucketBadge bucket={row.ageBucket} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* AP Aging aggregate table (by currency) */}
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
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.currency}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--ink)' }}>{fmt(row.current,    row.currency)}</td>
                    <td className={`${td} tabular-nums`} style={{ color: row.days1to30  > 0 ? '#d97706' : 'var(--muted)' }}>{fmt(row.days1to30,  row.currency)}</td>
                    <td className={`${td} tabular-nums`} style={{ color: row.days31to60 > 0 ? '#ea580c' : 'var(--muted)' }}>{fmt(row.days31to60, row.currency)}</td>
                    <td className={`${td} tabular-nums`} style={{ color: row.days61to90 > 0 ? '#dc2626' : 'var(--muted)' }}>{fmt(row.days61to90, row.currency)}</td>
                    <td className={`${td} tabular-nums`} style={{ color: row.over90    > 0 ? '#9f1239' : 'var(--muted)' }}>{fmt(row.over90,     row.currency)}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(row.total,     row.currency)}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>{row.invoiceCount}</td>
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
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.currency}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>{row.pendingApproval}</td>
                    <td className={`${td} tabular-nums`} style={{ color: row.amendmentPending > 0 ? '#d97706' : 'var(--muted)' }}>{row.amendmentPending}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>{row.approvedAwaitingSend}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>{row.sentToErp}</td>
                    <td className={`${td} tabular-nums`} style={{ color: row.dueToday > 0 ? '#2563eb' : 'var(--muted)' }}>{row.dueToday}</td>
                    <td className={`${td} tabular-nums`} style={{ color: row.overdue > 0 ? '#dc2626' : 'var(--muted)' }}>{row.overdue}</td>
                    <td className={`${td} tabular-nums`} style={{ color: 'var(--ink)', fontWeight: 500 }}>{fmt(row.totalPendingAmount, row.currency)}</td>
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
