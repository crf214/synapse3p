'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface SpendRow {
  entityId:        string
  entityName:      string
  currency:        string
  totalAmount:     number
  usdEquivalent:   number | null
  fxRate:          number | null
  fxRateDate:      string | null
  invoiceCount:    number
  paidCount:       number
  pendingCount:    number
  lastInvoiceDate: string | null
}

interface ApiResponse {
  spend:       SpendRow[]
  periodStart: string
  periodEnd:   string
  isLive:      boolean
  snapshotAge?: number
  currencies:  string[]
}

function toInputDate(iso: string) {
  return iso.slice(0, 10)
}

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)
}

function defaultStart() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

function defaultEnd() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

export default function SpendPage() {
  const [periodStart, setPeriodStart] = useState(defaultStart)
  const [periodEnd,   setPeriodEnd]   = useState(defaultEnd)
  const [data,    setData]    = useState<ApiResponse | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/reports/spend?periodStart=${periodStart}&periodEnd=${periodEnd}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [periodStart, periodEnd])

  useEffect(() => { fetchData() }, [fetchData])

  const th = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wide'
  const td = 'px-4 py-3 text-sm'

  // Group rows by currency
  const byCurrency: Record<string, SpendRow[]> = {}
  for (const row of data?.spend ?? []) {
    if (!byCurrency[row.currency]) byCurrency[row.currency] = []
    byCurrency[row.currency].push(row)
  }
  const currencies = Object.keys(byCurrency).sort()

  const exportHref = `/api/reports/export?report=spend&format=csv&periodStart=${periodStart}&periodEnd=${periodEnd}`

  return (
    <div className="p-8 max-w-5xl space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--muted)' }}>
            <Link href="/dashboard/reports" style={{ color: 'var(--muted)' }}>Reports</Link>
            <span>/</span>
            <span>Spend by Vendor</span>
          </div>
          <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>
            Spend by Vendor
          </h1>
        </div>
        <a
          href={exportHref}
          className="text-xs font-medium px-3 py-1.5 rounded-lg self-end"
          style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}
        >
          Export CSV
        </a>
      </div>

      {/* Date range controls */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>From</label>
          <input
            type="date"
            value={periodStart}
            onChange={e => setPeriodStart(e.target.value)}
            className="text-sm rounded-lg px-3 py-2"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>To</label>
          <input
            type="date"
            value={periodEnd}
            onChange={e => setPeriodEnd(e.target.value)}
            className="text-sm rounded-lg px-3 py-2"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          />
        </div>
        <button
          onClick={fetchData}
          className="text-sm font-medium px-4 py-2 rounded-lg"
          style={{ background: '#2563eb', color: '#fff' }}
        >
          Apply
        </button>
        {data && (
          <span className="text-xs self-center" style={{ color: 'var(--muted)' }}>
            {data.isLive ? 'Live' : `Snapshot ${data.snapshotAge}m ago`}
          </span>
        )}
      </div>

      {/* Results */}
      {loading && <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>}
      {error   && <p className="text-sm text-red-600">{error}</p>}

      {!loading && data && data.spend.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No spend data for this period.</p>
      )}

      {!loading && data && data.spend.length > 0 && (
        <div className="space-y-8">
          {/* Currency summary */}
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {currencies.length} {currencies.length === 1 ? 'currency' : 'currencies'}: {currencies.join(', ')}
            &nbsp;— amounts are not summed across currencies.
          </p>

          {/* One table section per currency */}
          {currencies.map(currency => {
            const rows = byCurrency[currency]
            const subtotal = rows.reduce((s, r) => s + r.totalAmount, 0)
            const usdSubtotal = rows.reduce((s, r) => s + (r.usdEquivalent ?? 0), 0)

            return (
              <section key={currency}>
                <h2 className="font-medium text-sm mb-2 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                  {currency}
                  <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>
                    {rows.length} vendor{rows.length !== 1 ? 's' : ''} · subtotal {fmt(subtotal, currency)}
                    {currency !== 'USD' && usdSubtotal > 0 && ` ≈ ${fmt(usdSubtotal, 'USD')}`}
                  </span>
                </h2>
                <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  <table className="w-full">
                    <thead style={{ background: 'var(--surface)' }}>
                      <tr>
                        {['Vendor', 'Total Amount', 'USD Equivalent', 'Invoices', 'Paid', 'Pending', 'Last Invoice'].map(h => (
                          <th key={h} className={th} style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={row.entityId}
                          style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                          <td className={td} style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.entityName}</td>
                          <td className={`${td} tabular-nums`} style={{ color: 'var(--ink)' }}>{fmt(row.totalAmount, currency)}</td>
                          <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>
                            {row.usdEquivalent != null ? fmt(row.usdEquivalent, 'USD') : '—'}
                          </td>
                          <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>{row.invoiceCount}</td>
                          <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>{row.paidCount}</td>
                          <td className={`${td} tabular-nums`} style={{ color: 'var(--muted)' }}>{row.pendingCount}</td>
                          <td className={td} style={{ color: 'var(--muted)' }}>
                            {row.lastInvoiceDate ? new Date(row.lastInvoiceDate).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
