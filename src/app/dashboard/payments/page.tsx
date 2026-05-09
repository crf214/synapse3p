'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])

type PIStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SENT_TO_ERP'
  | 'CONFIRMED' | 'CANCELLED' | 'FAILED' | 'AMENDMENT_PENDING'

interface PIRow {
  id:             string
  amount:         number
  currency:       string
  status:         PIStatus
  dueDate:        string | null
  currentVersion: number
  erpReference:   string | null
  createdAt:      string
  entity:         { id: string; name: string }
  invoice:        { id: string; invoiceNo: string; amount: number }
  creator:        { id: string; name: string | null; email: string } | null
  approver:       { id: string; name: string | null; email: string } | null
}

const STATUS_COLOR: Record<PIStatus, { bg: string; text: string }> = {
  DRAFT:             { bg: '#f8fafc', text: '#64748b' },
  PENDING_APPROVAL:  { bg: '#fff7ed', text: '#ea580c' },
  APPROVED:          { bg: '#f0fdf4', text: '#16a34a' },
  SENT_TO_ERP:       { bg: '#eff6ff', text: '#2563eb' },
  CONFIRMED:         { bg: '#f0fdf4', text: '#15803d' },
  CANCELLED:         { bg: '#fef2f2', text: '#dc2626' },
  FAILED:            { bg: '#fef2f2', text: '#dc2626' },
  AMENDMENT_PENDING: { bg: '#fdf4ff', text: '#9333ea' },
}

const STATUS_LABEL: Record<PIStatus, string> = {
  DRAFT:             'Draft',
  PENDING_APPROVAL:  'Pending Approval',
  APPROVED:          'Approved',
  SENT_TO_ERP:       'Sent to ERP',
  CONFIRMED:         'Confirmed',
  CANCELLED:         'Cancelled',
  FAILED:            'Failed',
  AMENDMENT_PENDING: 'Amendment Pending',
}

function fmtAmt(v: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function PaymentsPage() {
  const user   = useUser()
  const router = useRouter()

  const [status, setStatus] = useState('')
  const [page,   setPage]   = useState(1)

  // Reset to page 1 whenever filter changes
  useEffect(() => { setPage(1) }, [status])

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.payments.list({ page, status }),
    queryFn:  async () => {
      const p = new URLSearchParams({ page: String(page) })
      if (status) p.set('status', status)
      const res = await fetch(`/api/payment-instructions?${p}`)
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ payments: PIRow[]; total: number }>
    },
  })

  const rows  = data?.payments ?? []
  const total = data?.total    ?? 0

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  // Count actionable items
  const pendingCount   = rows.filter(r => r.status === 'PENDING_APPROVAL').length
  const amendmentCount = rows.filter(r => r.status === 'AMENDMENT_PENDING').length

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Payment Instructions</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {total} instruction{total !== 1 ? 's' : ''}
            {pendingCount > 0 && ` · ${pendingCount} pending approval`}
            {amendmentCount > 0 && ` · ${amendmentCount} amendment${amendmentCount !== 1 ? 's' : ''} pending`}
          </p>
        </div>
        <Link href="/dashboard/payments/executions"
          className="text-sm px-4 py-2 rounded-lg border"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          Execution Monitor →
        </Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_ERP', 'AMENDMENT_PENDING', 'CONFIRMED', 'CANCELLED'] as const).map(s => {
          const label = s === '' ? 'All' : STATUS_LABEL[s as PIStatus]
          const active = status === s
          return (
            <button key={s} onClick={() => setStatus(s)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{
                background: active ? '#2563eb' : 'var(--surface)',
                color:      active ? '#fff'     : 'var(--muted)',
                border:     active ? 'none'     : '1px solid var(--border)',
              }}>
              {label}
            </button>
          )
        })}
      </div>

      {isError && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          Could not load payment instructions.
        </div>
      )}

      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No payment instructions found</p>
          <p className="text-sm">Payment instructions are created from approved invoices.</p>
          <Link href="/dashboard/invoices" className="text-sm mt-2 inline-block" style={{ color: '#2563eb' }}>
            Go to Invoices →
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Invoice', 'Entity', 'Amount', 'Due Date', 'Status', 'Version', 'ERP Ref', 'Created by'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const col  = STATUS_COLOR[r.status]
                  const days = daysUntil(r.dueDate)
                  const overdue = days !== null && days < 0 && !['CONFIRMED','CANCELLED','FAILED'].includes(r.status)
                  const dueSoon = days !== null && days >= 0 && days <= 3 && !['CONFIRMED','CANCELLED','FAILED'].includes(r.status)

                  return (
                    <tr key={r.id}
                      onClick={() => router.push(`/dashboard/payments/${r.id}`)}
                      className="cursor-pointer transition-colors hover:bg-blue-50"
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/invoices/${r.invoice.id}/review`}
                          onClick={e => e.stopPropagation()}
                          className="font-mono text-xs hover:underline" style={{ color: '#2563eb' }}>
                          {r.invoice.invoiceNo}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/entities/${r.entity.id}`}
                          onClick={e => e.stopPropagation()}
                          className="hover:underline" style={{ color: 'var(--ink)' }}>
                          {r.entity.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                        {fmtAmt(r.amount, r.currency)}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: overdue ? '#dc2626' : dueSoon ? '#ea580c' : 'var(--muted)' }}>
                        {fmtDate(r.dueDate)}
                        {overdue  && <span className="ml-1 font-medium">(overdue)</span>}
                        {dueSoon  && !overdue && <span className="ml-1">({days}d)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: col.bg, color: col.text }}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-center" style={{ color: 'var(--muted)' }}>
                        v{r.currentVersion}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--muted)' }}>
                        {r.erpReference ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        <div>{r.creator?.name ?? r.creator?.email ?? '—'}</div>
                        <div>{fmtDate(r.createdAt)}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {total > 50 && (
            <div className="flex justify-center gap-2 mt-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {Math.ceil(total / 50)}
              </span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
                className="px-3 py-1.5 rounded-xl text-sm disabled:opacity-40"
                style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
