'use client'

import { useCallback, useEffect, useState } from 'react'

interface PaymentRow {
  id: string; amount: number; currency: string; rail: string
  status: string; scheduledAt: string | null; executedAt: string | null
  invoice: { id: string; invoiceNo: string }
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  SCHEDULED:  { bg: '#fff7ed', text: '#ea580c' },
  PROCESSING: { bg: '#eff6ff', text: '#2563eb' },
  COMPLETED:  { bg: '#f0fdf4', text: '#16a34a' },
  FAILED:     { bg: '#fef2f2', text: '#dc2626' },
  CANCELLED:  { bg: '#f1f5f9', text: '#475569' },
}

const RAIL_LABEL: Record<string, string> = {
  BANK_API: 'Bank Transfer', ERP: 'ERP', STRIPE: 'Stripe',
  ACH: 'ACH', WIRE: 'Wire', SEPA: 'SEPA',
}

function fmtAmt(v: number, cur: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PortalPaymentsPage() {
  const [rows,    setRows]    = useState<PaymentRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [page,    setPage]    = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/payments?page=${page}`)
      if (!res.ok) throw new Error()
      const d = await res.json()
      setRows(d.payments)
      setTotal(d.total)
    } catch {
      setError('Could not load payments.')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>My Payments</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{total} payment{total !== 1 ? 's' : ''}</p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--muted)' }}>No payments found.</div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Invoice', 'Amount', 'Method', 'Scheduled', 'Paid', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((pay, i) => {
                  const col = STATUS_COLOR[pay.status] ?? { bg: '#f8fafc', text: '#64748b' }
                  return (
                    <tr key={pay.id}
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: '#2563eb' }}>
                        {pay.invoice.invoiceNo}
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                        {fmtAmt(pay.amount, pay.currency)}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {RAIL_LABEL[pay.rail] ?? pay.rail}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtDate(pay.scheduledAt)}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtDate(pay.executedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: col.bg, color: col.text }}>
                          {pay.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {total > 20 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Previous</button>
              <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {Math.ceil(total / 20)}
              </span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 20)}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
