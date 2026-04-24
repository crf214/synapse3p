'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

type ItemType = 'PO' | 'INVOICE' | 'MERGED_AUTH'

interface ApprovalItem {
  id:        string
  type:      ItemType
  subjectId: string
  reference: string
  title:     string
  entityId:  string | null
  entity:    string
  amount:    number
  currency:  string
  step:      number | null
  requester: { id: string; name: string | null; email: string } | null
  createdAt: string
}

const TYPE_LABEL: Record<ItemType, string> = {
  PO:          'Purchase Order',
  INVOICE:     'Invoice',
  MERGED_AUTH: 'Batch Auth',
}

const TYPE_COLOR: Record<ItemType, { bg: string; text: string; border: string }> = {
  PO:          { bg: '#eff6ff', text: '#2563eb', border: '#2563eb22' },
  INVOICE:     { bg: '#f0fdf4', text: '#16a34a', border: '#16a34a22' },
  MERGED_AUTH: { bg: '#fdf4ff', text: '#9333ea', border: '#9333ea22' },
}

function fmtAmt(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function subjectHref(item: ApprovalItem) {
  if (item.type === 'PO')          return `/dashboard/purchase-orders/${item.subjectId}`
  if (item.type === 'INVOICE')     return `/dashboard/invoices/${item.subjectId}`
  if (item.type === 'MERGED_AUTH') return `/dashboard/invoices?batch=${item.subjectId}`
  return '#'
}

export default function ApprovalsPage() {
  const user = useUser()
  const [items,    setItems]    = useState<ApprovalItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState<ItemType | 'ALL'>('ALL')
  const [deciding, setDeciding] = useState<string | null>(null)
  const [modal,    setModal]    = useState<{ item: ApprovalItem; decision: 'APPROVED' | 'REJECTED' } | null>(null)
  const [comments, setComments] = useState('')
  const [error,    setError]    = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/approvals')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setItems(data.items)
    } catch {
      setError('Could not load approvals.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return (
      <div className="p-8">
        <p style={{ color: 'var(--muted)' }}>You do not have access to this page.</p>
      </div>
    )
  }

  const visible = filter === 'ALL' ? items : items.filter(i => i.type === filter)

  async function decide() {
    if (!modal) return
    setDeciding(modal.item.id)
    try {
      const res = await fetch(`/api/approvals/${modal.item.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: modal.item.type, decision: modal.decision, comments }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Failed')
      }
      setModal(null)
      setComments('')
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit decision')
    } finally {
      setDeciding(null)
    }
  }

  const counts: Record<ItemType | 'ALL', number> = {
    ALL:          items.length,
    PO:           items.filter(i => i.type === 'PO').length,
    INVOICE:      items.filter(i => i.type === 'INVOICE').length,
    MERGED_AUTH:  items.filter(i => i.type === 'MERGED_AUTH').length,
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>Approvals</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Items waiting for your decision
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['ALL', 'PO', 'INVOICE', 'MERGED_AUTH'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
            style={{
              background: filter === t ? '#2563eb' : 'var(--surface)',
              color:      filter === t ? '#fff'     : 'var(--muted)',
              border:     filter === t ? 'none'     : '1px solid var(--border)',
            }}
          >
            {t === 'ALL' ? 'All' : TYPE_LABEL[t]}
            {counts[t] > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs"
                style={{ background: filter === t ? '#ffffff33' : '#eff6ff', color: filter === t ? '#fff' : '#2563eb' }}>
                {counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <div className="text-4xl mb-4">✓</div>
          <p className="text-lg font-medium mb-1">All clear</p>
          <p className="text-sm">No pending approvals{filter !== 'ALL' ? ` for ${TYPE_LABEL[filter]}` : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(item => {
            const col = TYPE_COLOR[item.type]
            return (
              <div key={item.id} className="rounded-2xl p-5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: col.bg, color: col.text, border: `1px solid ${col.border}` }}>
                        {TYPE_LABEL[item.type]}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        {item.reference}
                        {item.step !== null && ` · Step ${item.step}`}
                      </span>
                    </div>

                    <Link href={subjectHref(item)}
                      className="text-sm font-semibold hover:underline block truncate"
                      style={{ color: 'var(--ink)' }}>
                      {item.title}
                    </Link>

                    <div className="mt-1 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {item.entityId ? (
                        <Link href={`/dashboard/entities/${item.entityId}`} className="hover:underline">
                          {item.entity}
                        </Link>
                      ) : (
                        <span>{item.entity}</span>
                      )}
                      <span>{fmtDate(item.createdAt)}</span>
                      {item.requester && (
                        <span>from {item.requester.name ?? item.requester.email}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 text-right">
                    <div className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                      {fmtAmt(item.amount, item.currency)}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => { setModal({ item, decision: 'APPROVED' }); setComments('') }}
                        disabled={deciding === item.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #16a34a33' }}>
                        Approve
                      </button>
                      <button
                        onClick={() => { setModal({ item, decision: 'REJECTED' }); setComments('') }}
                        disabled={deciding === item.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #dc262633' }}>
                        Reject
                      </button>
                      <Link href={subjectHref(item)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                        View
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Decision modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: '#00000055' }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-xl"
            style={{ background: '#fff', border: '1px solid var(--border)' }}>
            <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--ink)' }}>
              {modal.decision === 'APPROVED' ? 'Approve' : 'Reject'} — {modal.item.title}
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              {fmtAmt(modal.item.amount, modal.item.currency)} · {modal.item.entity}
            </p>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink)' }}>
              Comments {modal.decision === 'REJECTED' && <span style={{ color: '#dc2626' }}>*</span>}
            </label>
            <textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              rows={3}
              className="w-full rounded-xl px-3 py-2 text-sm resize-none"
              style={{ border: '1px solid var(--border)', outline: 'none', color: 'var(--ink)' }}
              placeholder={modal.decision === 'REJECTED' ? 'Reason for rejection…' : 'Optional notes…'}
            />
            {error && (
              <p className="text-xs mt-2" style={{ color: '#dc2626' }}>{error}</p>
            )}
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => { setModal(null); setComments(''); setError(null) }}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button
                onClick={decide}
                disabled={!!deciding || (modal.decision === 'REJECTED' && !comments.trim())}
                className="px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{
                  background: modal.decision === 'APPROVED' ? '#16a34a' : '#dc2626',
                  color: '#fff',
                }}>
                {deciding ? 'Submitting…' : modal.decision === 'APPROVED' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
