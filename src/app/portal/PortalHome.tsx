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
  id: string; invoiceNo: string; amount: number; currency: string
  status: string; dueDate: string | null; createdAt: string
}

interface PaymentSummary {
  id: string; amount: number; currency: string; status: string
  scheduledAt: string | null; executedAt: string | null
  invoice: { id: string; invoiceNo: string }
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
  DUPLICATE:        { bg: '#fdf4ff', text: '#9333ea' },
  PENDING_APPROVAL: { bg: '#fff7ed', text: '#ea580c' },
}

const PAY_STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  SCHEDULED:  { bg: '#fff7ed', text: '#ea580c' },
  PROCESSING: { bg: '#eff6ff', text: '#2563eb' },
  COMPLETED:  { bg: '#f0fdf4', text: '#16a34a' },
  FAILED:     { bg: '#fef2f2', text: '#dc2626' },
  CANCELLED:  { bg: '#f1f5f9', text: '#475569' },
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
      return res.json() as Promise<{ invoices: InvoiceSummary[]; total: number }>
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

  // meData === null means 404 (no entity linked)
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

  const info     = meData ?? null
  const invoices = invData?.invoices ?? []
  const invTotal = invData?.total    ?? 0
  const payments = payData?.payments ?? []
  const payTotal = payData?.total    ?? 0

  const contractDays     = daysUntil(info?.contractEnd ?? null)
  const contractExpiring = contractDays !== null && contractDays >= 0 && contractDays <= 30
  const contractExpired  = contractDays !== null && contractDays < 0

  const pendingInvoices = invoices.filter(i => ['RECEIVED','UNDER_REVIEW','PENDING_APPROVAL'].includes(i.status))
  const recentPayments  = payments.slice(0, 5)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
          Welcome back, {name}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          {info?.entity.name} · {role === 'VENDOR' ? 'Vendor' : 'Client'} Portal
          {info?.org && <span> · {info.org.name}</span>}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
        {[
          { label: 'Total Invoices',    value: String(invTotal), sub: `${pendingInvoices.length} pending` },
          { label: 'Total Payments',    value: String(payTotal), sub: payments.filter(p => p.status === 'COMPLETED').length + ' completed' },
          {
            label: 'Contract Start',
            value: fmtDate(info?.contractStart ?? null),
            sub: '',
          },
          {
            label: 'Contract End',
            value: fmtDate(info?.contractEnd ?? null),
            sub: contractExpired ? 'Expired' : contractExpiring ? `${contractDays}d remaining` : '',
            warn: contractExpired || contractExpiring,
          },
        ].map(({ label, value, sub, warn }) => (
          <div key={label} className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: '#fff' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--muted)' }}>{label}</p>
            <p className="text-xl font-semibold" style={{ color: warn ? '#dc2626' : 'var(--ink)' }}>{value}</p>
            {sub && <p className="text-xs mt-0.5" style={{ color: warn ? '#ea580c' : 'var(--muted)' }}>{sub}</p>}
          </div>
        ))}
      </div>

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
                    const col  = INV_STATUS_COLOR[inv.status] ?? { bg: '#f8fafc', text: '#64748b' }
                    const days = daysUntil(inv.dueDate)
                    const overdue = days !== null && days < 0 && !['PAID','REJECTED'].includes(inv.status)
                    return (
                      <tr key={inv.id}
                        style={{ borderBottom: i < Math.min(invoices.length, 6) - 1 ? '1px solid var(--border)' : undefined }}>
                        <td className="px-3 py-2.5 font-mono text-xs font-medium" style={{ color: '#2563eb' }}>
                          {inv.invoiceNo}
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
            {recentPayments.length === 0 ? (
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
                  {recentPayments.map((pay, i) => {
                    const col = PAY_STATUS_COLOR[pay.status] ?? { bg: '#f8fafc', text: '#64748b' }
                    return (
                      <tr key={pay.id}
                        style={{ borderBottom: i < recentPayments.length - 1 ? '1px solid var(--border)' : undefined }}>
                        <td className="px-3 py-2.5 font-mono text-xs" style={{ color: '#2563eb' }}>
                          {pay.invoice.invoiceNo}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-medium" style={{ color: 'var(--ink)' }}>
                          {fmtAmt(pay.amount, pay.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--muted)' }}>
                          {fmtDate(pay.executedAt ?? pay.scheduledAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: col.bg, color: col.text }}>
                            {pay.status}
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
