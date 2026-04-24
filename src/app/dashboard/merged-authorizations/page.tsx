'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])

type MAStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PAID'

interface MARow {
  id:           string
  reference:    string
  name:         string | null
  totalAmount:  number
  creditAmount: number
  netAmount:    number
  currency:     string
  status:       MAStatus
  itemCount:    number
  createdAt:    string
  approvedAt:   string | null
  creator:      { id: string; name: string | null; email: string } | null
  approver:     { id: string; name: string | null; email: string } | null
}

const STATUS_COLOR: Record<MAStatus, { bg: string; text: string }> = {
  DRAFT:            { bg: '#f8fafc', text: '#64748b' },
  PENDING_APPROVAL: { bg: '#fff7ed', text: '#ea580c' },
  APPROVED:         { bg: '#f0fdf4', text: '#16a34a' },
  REJECTED:         { bg: '#fef2f2', text: '#dc2626' },
  PAID:             { bg: '#eff6ff', text: '#2563eb' },
}

const STATUS_LABEL: Record<MAStatus, string> = {
  DRAFT:            'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED:         'Approved',
  REJECTED:         'Rejected',
  PAID:             'Paid',
}

function fmtAmt(v: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MergedAuthorizationsPage() {
  const user   = useUser()
  const router = useRouter()

  const [rows,    setRows]    = useState<MARow[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [status,  setStatus]  = useState('')
  const [page,    setPage]    = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(page) })
    if (status) p.set('status', status)
    try {
      const res = await fetch(`/api/merged-authorizations?${p}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.batches)
      setTotal(data.total)
    } catch {
      setError('Could not load merged authorizations.')
    } finally {
      setLoading(false)
    }
  }, [status, page])

  useEffect(() => { setPage(1) }, [status])
  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  const canCreate    = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER']).has(user.role ?? '')
  const pendingCount = rows.filter(r => r.status === 'PENDING_APPROVAL').length

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Merged Authorizations</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {total} batch{total !== 1 ? 'es' : ''}
            {pendingCount > 0 && ` · ${pendingCount} pending approval`}
          </p>
        </div>
        {canCreate && (
          <Link href="/dashboard/merged-authorizations/new"
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Batch
          </Link>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID'] as const).map(s => {
          const label  = s === '' ? 'All' : STATUS_LABEL[s as MAStatus]
          const active = status === s
          return (
            <button key={s} onClick={() => setStatus(s)}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{
                background: active ? '#2563eb' : 'var(--surface)',
                color:      active ? '#fff'    : 'var(--muted)',
                border:     active ? 'none'    : '1px solid var(--border)',
              }}>
              {label}
            </button>
          )
        })}
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
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No merged authorizations found</p>
          <p className="text-sm">Batch multiple approved invoices together for a single authorization.</p>
          {canCreate && (
            <Link href="/dashboard/merged-authorizations/new"
              className="text-sm mt-3 inline-block" style={{ color: '#2563eb' }}>
              Create your first batch →
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Reference', 'Name', 'Invoices', 'Total', 'Credits', 'Net Amount', 'Status', 'Created by'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const col = STATUS_COLOR[r.status]
                  return (
                    <tr key={r.id}
                      onClick={() => router.push(`/dashboard/merged-authorizations/${r.id}`)}
                      className="cursor-pointer transition-colors hover:bg-blue-50"
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: '#2563eb' }}>
                        {r.reference}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {r.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center text-xs" style={{ color: 'var(--muted)' }}>
                        {r.itemCount}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtAmt(r.totalAmount, r.currency)}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: r.creditAmount > 0 ? '#16a34a' : 'var(--muted)' }}>
                        {r.creditAmount > 0 ? `−${fmtAmt(r.creditAmount, r.currency)}` : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                        {fmtAmt(r.netAmount, r.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: col.bg, color: col.text }}>
                          {STATUS_LABEL[r.status]}
                        </span>
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
