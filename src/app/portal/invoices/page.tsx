'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

interface InvoiceRow {
  id: string; invoiceNo: string; amount: number; currency: string
  status: string; invoiceDate: string | null; dueDate: string | null; createdAt: string
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  RECEIVED:         { bg: '#f8fafc', text: '#64748b' },
  UNDER_REVIEW:     { bg: '#fff7ed', text: '#ea580c' },
  APPROVED:         { bg: '#f0fdf4', text: '#16a34a' },
  REJECTED:         { bg: '#fef2f2', text: '#dc2626' },
  PAID:             { bg: '#eff6ff', text: '#2563eb' },
  MATCHED:          { bg: '#f0fdf4', text: '#16a34a' },
  DUPLICATE:        { bg: '#fdf4ff', text: '#9333ea' },
  PENDING_APPROVAL: { bg: '#fff7ed', text: '#ea580c' },
}

function fmtAmt(v: number, cur: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function PortalInvoicesPage() {
  const router = useRouter()
  const [status, setStatus] = useState('')
  const [page,   setPage]   = useState(1)

  // Reset to page 1 whenever filter changes
  useEffect(() => { setPage(1) }, [status])

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.portal.invoices.list({ page, status }),
    queryFn:  async () => {
      const p = new URLSearchParams({ page: String(page) })
      if (status) p.set('status', status)
      const res = await fetch(`/api/portal/invoices?${p}`)
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ invoices: InvoiceRow[]; total: number }>
    },
  })

  const rows  = data?.invoices ?? []
  const total = data?.total    ?? 0

  const STATUSES = ['', 'RECEIVED', 'PENDING_APPROVAL', 'APPROVED', 'MATCHED', 'PAID', 'REJECTED']

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>My Invoices</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{total} invoice{total !== 1 ? 's' : ''}</p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUSES.map(s => {
          const active = status === s
          return (
            <button key={s} onClick={() => setStatus(s)}
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: active ? '#2563eb' : 'var(--surface)',
                color:      active ? '#fff'    : 'var(--muted)',
                border:     active ? 'none'    : '1px solid var(--border)',
              }}>
              {s === '' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          )
        })}
      </div>

      {isError && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          Could not load invoices.
        </div>
      )}

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--muted)' }}>No invoices found.</div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Invoice #', 'Invoice Date', 'Due Date', 'Amount', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((inv, i) => {
                  const col  = STATUS_COLOR[inv.status] ?? { bg: '#f8fafc', text: '#64748b' }
                  const days = daysUntil(inv.dueDate)
                  const overdue = days !== null && days < 0 && !['PAID','REJECTED'].includes(inv.status)
                  const dueSoon = days !== null && days >= 0 && days <= 5 && !['PAID','REJECTED'].includes(inv.status)
                  return (
                    <tr key={inv.id}
                      onClick={() => router.push(`/portal/invoices/${inv.id}`)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: '#2563eb' }}>
                        {inv.invoiceNo}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtDate(inv.invoiceDate)}
                      </td>
                      <td className="px-4 py-3 text-xs"
                        style={{ color: overdue ? '#dc2626' : dueSoon ? '#ea580c' : 'var(--muted)' }}>
                        {fmtDate(inv.dueDate)}
                        {overdue && <span className="ml-1 font-medium">(overdue)</span>}
                        {dueSoon && !overdue && <span className="ml-1">({days}d)</span>}
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                        {fmtAmt(inv.amount, inv.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: col.bg, color: col.text }}>
                          {inv.status.replace(/_/g, ' ')}
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
