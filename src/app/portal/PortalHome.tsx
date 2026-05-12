'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

interface EntityInfo {
  entity:             { id: string; name: string }
  org:                { id: string; name: string }
  onboardingStatus:   string
  contractStart:      string | null
  contractEnd:        string | null
  approvedSpendLimit: number | null
}

interface InvoiceSummary {
  id:          string
  invoiceNo:   string
  amount:      number
  currency:    string
  status:      string
  dueDate:     string | null
  createdAt:   string
  hasDispute:  boolean
}

interface PaymentSummary {
  id:            string
  paymentRef:    string
  invoiceNo:     string
  amount:        number
  currency:      string
  status:        string
  scheduledDate: string | null
  paidDate:      string | null
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

const INV_STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  RECEIVED:         { bg: '#f8fafc', text: '#64748b' },
  UNDER_REVIEW:     { bg: '#fff7ed', text: '#ea580c' },
  APPROVED:         { bg: '#f0fdf4', text: '#16a34a' },
  REJECTED:         { bg: '#fef2f2', text: '#dc2626' },
  PAID:             { bg: '#eff6ff', text: '#2563eb' },
  MATCHED:          { bg: '#f0fdf4', text: '#16a34a' },
  UNMATCHED:        { bg: '#fffbeb', text: '#d97706' },
  DUPLICATE:        { bg: '#fdf4ff', text: '#9333ea' },
  PENDING_REVIEW:   { bg: '#fff7ed', text: '#ea580c' },
  CANCELLED:        { bg: '#f1f5f9', text: '#475569' },
}

const PAY_STATUS_DISPLAY: Record<string, string> = {
  PENDING_APPROVAL:  'Pending',
  APPROVED:          'Approved',
  CONFIRMED:         'Paid',
  CANCELLED:         'Cancelled',
  SENT_TO_ERP:       'Processing',
  FAILED:            'Failed',
}

export default function PortalHome({ name, role }: { name: string; role: string }) {
  const { data: meData, isLoading: meLoading, isError: meError } = useQuery({
    queryKey: queryKeys.portal.me,
    queryFn:  async () => {
      const res = await fetch('/api/portal/me')
      if (res.status === 404) return null
      if (!res.ok) throw new Error()
      return res.json() as Promise<EntityInfo>
    },
  })

  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: queryKeys.portal.invoices.list({ page: 1 }),
    queryFn:  async () => {
      const res = await fetch('/api/portal/invoices?page=1')
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ invoices: InvoiceSummary[]; total: number; statusCounts: Record<string, number> }>
    },
  })

  const { data: payData, isLoading: payLoading } = useQuery({
    queryKey: queryKeys.portal.payments.list({ page: 1 }),
    queryFn:  async () => {
      const res = await fetch('/api/portal/payments?page=1')
      if (!res.ok) throw new Error()
      return res.json() as Promise<{ payments: PaymentSummary[]; total: number }>
    },
  })

  const loading = meLoading || invLoading || payLoading

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading your portal…</p>
      </div>
    )
  }

  if (!meError && meData === null) {
    return (
      <div className="p-8 max-w-xl mx-auto mt-16 text-center">
        <div className="text-4xl mb-4">◎</div>
        <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--ink)' }}>Portal setup in progress</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Your account has not been linked to an entity yet. Please contact your account manager.
        </p>
      </div>
    )
  }

  const info         = meData ?? null
  const invoices     = invData?.invoices     ?? []
  const invTotal     = invData?.total        ?? 0
  const statusCounts = invData?.statusCounts ?? {}
  const payments     = payData?.payments     ?? []
  const payTotal     = payData?.total        ?? 0

  const contractDays     = daysUntil(info?.contractEnd ?? null)
  const contractExpiring = contractDays !== null && contractDays >= 0 && contractDays <= 30
  const contractExpired  = contractDays !== null && contractDays < 0

  // Bucket invoice status counts for the dashboard
  const pendingCount  = (statusCounts['RECEIVED'] ?? 0)
                      + (statusCounts['UNMATCHED'] ?? 0)
                      + (statusCounts['PENDING_REVIEW'] ?? 0)
                      + (statusCounts['UNDER_REVIEW'] ?? 0)
  const approvedCount = (statusCounts['APPROVED'] ?? 0) + (statusCounts['MATCHED'] ?? 0)
  const paidCount     = statusCounts['PAID'] ?? 0

  // Outstanding payments = non-confirmed, non-cancelled
  const outstandingPayments = payTotal - (
    payments.filter(p => p.status === 'CONFIRMED' || p.status === 'CANCELLED').length
  )

  // Disputed invoices from this page (first 20)
  const disputedInvoices = invoices.filter(i => i.hasDispute)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
          Welcome back, {name}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          {info?.entity.name ?? 'Your organisation'} · {role === 'VENDOR' ? 'Vendor' : 'Client'} Portal
          {info?.org && <span> · {info.org.name}</span>}
        </p>
      </div>

      {/* Invoice status breakdown cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Pending',           value: pendingCount,     color: '#64748b', bg: '#f8fafc' },
          { label: 'Approved',          value: approvedCount,    color: '#16a34a', bg: '#f0fdf4' },
          { label: 'Paid',              value: paidCount,        color: '#2563eb', bg: '#eff6ff' },
          { label: 'Outstanding Pmts',  value: outstandingPayments, color: '#d97706', bg: '#fffbeb' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: bg }}>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{label}</p>
            <p className="text-2xl font-display tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Contract expiry notice */}
      {(contractExpired || contractExpiring) && contractDays !== null && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm"
          style={{
            background: contractExpired ? '#fef2f2' : '#fff7ed',
            color:      contractExpired ? '#dc2626' : '#d97706',
            border:    `1px solid ${contractExpired ? '#fecaca' : '#fed7aa'}`,
          }}>
          {contractExpired
            ? 'Your contract with this organisation has expired. Please contact your account manager.'
            : `Your contract expires in ${contractDays} day${contractDays !== 1 ? 's' : ''}.`}
        </div>
      )}

      {/* Disputed invoices alert */}
      {disputedInvoices.length > 0 && (
        <div className="mb-6 rounded-2xl p-5" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#d97706' }}>
            ⚠ Invoices with Open Disputes ({disputedInvoices.length})
          </h2>
          <div className="space-y-2">
            {disputedInvoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs" style={{ color: 'var(--ink)' }}>{inv.invoiceNo}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {fmtAmt(inv.amount, inv.currency)}
                  </span>
                  <Link href={`/portal/invoices/${inv.id}`}
                    className="text-xs px-2.5 py-1 rounded-lg font-medium"
                    style={{ background: '#fff', border: '1px solid #fed7aa', color: '#d97706' }}>
                    View dispute →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8">
        {/* Recent invoices */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Recent Invoices
            </h2>
            <Link href="/portal/invoices" className="text-xs hover:underline" style={{ color: '#2563eb' }}>
              View all ({invTotal}) →
            </Link>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {invoices.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
                No invoices found.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                    {['Invoice #', 'Amount', 'Due', 'Status'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide"
                        style={{ color: 'var(--muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 6).map((inv, i) => {
                    const col    = INV_STATUS_COLOR[inv.status] ?? { bg: '#f8fafc', text: '#64748b' }
                    const days   = daysUntil(inv.dueDate)
                    const overdue = days !== null && days < 0 && !['PAID','REJECTED','CANCELLED'].includes(inv.status)
                    return (
                      <tr key={inv.id}
                        style={{ borderBottom: i < Math.min(invoices.length, 6) - 1 ? '1px solid var(--border)' : undefined }}>
                        <td className="px-3 py-2.5 font-mono text-xs font-medium" style={{ color: '#2563eb' }}>
                          <Link href={`/portal/invoices/${inv.id}`}>{inv.invoiceNo}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--ink)' }}>
                          {fmtAmt(inv.amount, inv.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: overdue ? '#dc2626' : 'var(--muted)' }}>
                          {fmtDate(inv.dueDate)}
                          {overdue && <span className="ml-1 font-medium">(overdue)</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: col.bg, color: col.text }}>
                            {inv.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recent payments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Recent Payments
            </h2>
            <Link href="/portal/payments" className="text-xs hover:underline" style={{ color: '#2563eb' }}>
              View all ({payTotal}) →
            </Link>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {payments.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
                No payments found.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                    {['Invoice', 'Amount', 'Scheduled', 'Status'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide"
                        style={{ color: 'var(--muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.slice(0, 5).map((pay, i) => {
                    const label = PAY_STATUS_DISPLAY[pay.status] ?? pay.status
                    return (
                      <tr key={pay.id}
                        style={{ borderBottom: i < Math.min(payments.length, 5) - 1 ? '1px solid var(--border)' : undefined }}>
                        <td className="px-3 py-2.5 font-mono text-xs" style={{ color: '#2563eb' }}>
                          {pay.invoiceNo}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--ink)' }}>
                          {fmtAmt(pay.amount, pay.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--muted)' }}>
                          {fmtDate(pay.scheduledDate)}
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--muted)' }}>
                          {label}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="mt-8 flex gap-3 flex-wrap">
        {[
          { href: '/portal/invoices',  label: 'All Invoices',  icon: '◎' },
          { href: '/portal/payments',  label: 'All Payments',  icon: '◈' },
          { href: '/portal/documents', label: 'Documents',     icon: '◫' },
        ].map(({ href, label, icon }) => (
          <Link key={href} href={href}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-colors hover:bg-blue-50"
            style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: '#fff' }}>
            <span style={{ opacity: 0.6 }}>{icon}</span>
            {label}
          </Link>
        ))}
      </div>
    </div>
  )
}
