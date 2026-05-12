'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

interface PaymentRow {
  id:            string
  paymentRef:    string
  invoiceId:     string
  invoiceNo:     string
  amount:        number
  currency:      string
  status:        string
  scheduledDate: string | null
  paidDate:      string | null
}

// Map PaymentInstructionStatus → display label + color
const STATUS_DISPLAY: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT:             { label: 'Draft',             bg: '#f8fafc', text: '#64748b' },
  PENDING_APPROVAL:  { label: 'Pending',           bg: '#f1f5f9', text: '#475569' },
  APPROVED:          { label: 'Approved',          bg: '#eff6ff', text: '#2563eb' },
  SENT_TO_ERP:       { label: 'Processing',        bg: '#fff7ed', text: '#ea580c' },
  CONFIRMED:         { label: 'Paid',              bg: '#f0fdf4', text: '#16a34a' },
  CANCELLED:         { label: 'Cancelled',         bg: '#fef2f2', text: '#dc2626' },
  FAILED:            { label: 'Failed',            bg: '#fef2f2', text: '#dc2626' },
  AMENDMENT_PENDING: { label: 'Amendment Pending', bg: '#fdf4ff', text: '#9333ea' },
  RECONCILED:        { label: 'Reconciled',        bg: '#f0fdf4', text: '#16a34a' },
}

function fmtAmt(v: number, cur: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PortalPaymentsPage() {
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.portal.payments.list({ page }),
    queryFn:  async () => {
      const res = await fetch(`/api/portal/payments?page=${page}`)
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ payments: PaymentRow[]; total: number }>
    },
  })

  const rows  = data?.payments ?? []
  const total = data?.total    ?? 0

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Payments</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          {total} payment record{total !== 1 ? 's' : ''} · read only
        </p>
      </div>

      {isError && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          Could not load payments.
        </div>
      )}

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 rounded-2xl"
          style={{ border: '1px dashed var(--border)', color: 'var(--muted)' }}>
          <p className="text-sm">No payment records yet.</p>
          <p className="text-xs mt-1">Payment records appear here once your invoices are approved for payment.</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Payment Ref', 'Invoice', 'Amount', 'Status', 'Scheduled Date', 'Paid Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((pay, i) => {
                  const disp = STATUS_DISPLAY[pay.status] ?? { label: pay.status, bg: '#f8fafc', text: '#64748b' }
                  return (
                    <tr key={pay.id}
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: 'var(--ink)' }}>
                        {pay.paymentRef}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: '#2563eb' }}>
                        {pay.invoiceNo}
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                        {fmtAmt(pay.amount, pay.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: disp.bg, color: disp.text }}>
                          {disp.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtDate(pay.scheduledDate)}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: pay.paidDate ? '#16a34a' : 'var(--muted)' }}>
                        {fmtDate(pay.paidDate)}
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
