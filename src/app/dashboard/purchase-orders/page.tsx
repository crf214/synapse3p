'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])

type PoStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  | 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED' | 'INVOICED' | 'CLOSED' | 'CANCELLED'

interface PORow {
  id:           string
  poNumber:     string
  title:        string
  totalAmount:  number
  currency:     string
  status:       PoStatus
  createdAt:    string
  entity:       { id: string; name: string; slug: string }
  approvals:    { step: number; status: string }[]
}

interface Pagination { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean }

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<PoStatus, { bg: string; color: string; border: string; label: string }> = {
  DRAFT:              { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Draft'             },
  PENDING_APPROVAL:   { bg: '#fffbeb', color: '#d97706', border: '#d9770622', label: 'Pending Approval'  },
  APPROVED:           { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Approved'          },
  REJECTED:           { bg: '#fef2f2', color: '#dc2626', border: '#dc262622', label: 'Rejected'          },
  PARTIALLY_RECEIVED: { bg: '#eff6ff', color: '#2563eb', border: '#2563eb22', label: 'Part. Received'    },
  FULLY_RECEIVED:     { bg: '#f0fdf4', color: '#16a34a', border: '#16a34a22', label: 'Fully Received'    },
  INVOICED:           { bg: '#f5f3ff', color: '#7c3aed', border: '#7c3aed22', label: 'Invoiced'          },
  CLOSED:             { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Closed'            },
  CANCELLED:          { bg: '#f9fafb', color: '#6b7280', border: '#6b728022', label: 'Cancelled'         },
}

function StatusBadge({ status }: { status: PoStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  )
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PurchaseOrdersPage() {
  const { role }  = useUser()
  const router    = useRouter()

  const [pos,        setPos]        = useState<PORow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const [status,   setStatus]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [page,     setPage]     = useState(1)

  const fetchPOs = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const sp = new URLSearchParams({ page: String(page), limit: '50' })
      if (status)   sp.set('status',   status)
      if (dateFrom) sp.set('dateFrom', dateFrom)
      if (dateTo)   sp.set('dateTo',   dateTo)

      const res  = await fetch(`/api/purchase-orders?${sp}`)
      const json = await res.json() as { purchaseOrders: PORow[]; pagination: Pagination; error?: { message: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load purchase orders')
      setPos(json.purchaseOrders)
      setPagination(json.pagination)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [page, status, dateFrom, dateTo])

  useEffect(() => { void fetchPOs() }, [fetchPOs])

  if (!role || !ALLOWED_ROLES.has(role)) {
    return (
      <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>
        You do not have permission to view purchase orders.
      </div>
    )
  }

  return (
    <div className="p-8 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Purchase Orders</h1>
          {pagination && (
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {pagination.total} total
            </p>
          )}
        </div>
        {!['AUDITOR'].includes(role) && (
          <Link href="/dashboard/purchase-orders/new"
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New PO
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="text-sm px-3 py-2 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_STYLES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          className="text-sm px-3 py-2 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
          className="text-sm px-3 py-2 rounded-lg border"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }} />

        {(status || dateFrom || dateTo) && (
          <button onClick={() => { setStatus(''); setDateFrom(''); setDateTo(''); setPage(1) }}
            className="text-sm px-3 py-2 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {error ? (
        <div className="p-4 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#dc2626' }}>{error}</div>
      ) : loading ? (
        <div className="text-sm py-12 text-center" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : pos.length === 0 ? (
        <div className="text-sm py-12 text-center" style={{ color: 'var(--muted)' }}>
          No purchase orders found.{' '}
          {!['AUDITOR'].includes(role) && (
            <Link href="/dashboard/purchase-orders/new" style={{ color: '#2563eb' }}>Create your first PO →</Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                {['PO Number', 'Vendor', 'Title', 'Amount', 'Status', 'Approval', 'Created'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-xs"
                    style={{ color: 'var(--muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pos.map((po, i) => {
                const pendingApproval = po.approvals.find(a => a.status === 'PENDING')
                return (
                  <tr key={po.id}
                    onClick={() => router.push(`/dashboard/purchase-orders/${po.id}`)}
                    className="cursor-pointer hover:bg-[var(--surface)] transition-colors"
                    style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                    <td className="px-4 py-3 font-mono font-medium text-xs" style={{ color: 'var(--ink)' }}>
                      {po.poNumber}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink)' }}>
                      {po.entity.name}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate" style={{ color: 'var(--ink)' }}>
                      {po.title}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                      {fmt(po.totalAmount, po.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={po.status} />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {pendingApproval ? `Step ${pendingApproval.step}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {new Date(po.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <button disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)}
              className="text-sm px-3 py-1.5 rounded-lg border disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              ← Prev
            </button>
            <button disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)}
              className="text-sm px-3 py-1.5 rounded-lg border disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
