'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

type ContractStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'UNDER_REVIEW' | 'RENEWED'
type ContractType   = 'MASTER' | 'SOW' | 'AMENDMENT' | 'NDA' | 'SLA' | 'FRAMEWORK' | 'OTHER'

interface ContractRow {
  id:               string
  contractNo:       string
  type:             ContractType
  status:           ContractStatus
  value:            number | null
  currency:         string
  startDate:        string | null
  endDate:          string | null
  renewalDate:      string | null
  autoRenew:        boolean
  noticePeriodDays: number
  createdAt:        string
  entity:           { id: string; name: string }
  owner:            { id: string; name: string | null; email: string }
}

const STATUS_COLOR: Record<ContractStatus, { bg: string; text: string }> = {
  DRAFT:        { bg: '#f8fafc', text: '#64748b' },
  ACTIVE:       { bg: '#f0fdf4', text: '#16a34a' },
  EXPIRED:      { bg: '#fef2f2', text: '#dc2626' },
  TERMINATED:   { bg: '#fef2f2', text: '#dc2626' },
  UNDER_REVIEW: { bg: '#fff7ed', text: '#ea580c' },
  RENEWED:      { bg: '#eff6ff', text: '#2563eb' },
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtAmt(v: number | null, currency: string) {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

export default function ContractsPage() {
  const user   = useUser()
  const router = useRouter()

  const [rows,    setRows]    = useState<ContractRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [status,  setStatus]  = useState('')
  const [q,       setQ]       = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (q)      params.set('q',      q)
    try {
      const res = await fetch(`/api/contracts?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.contracts)
      setTotal(data.total)
    } catch {
      setError('Could not load contracts.')
    } finally {
      setLoading(false)
    }
  }, [status, q])

  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Contracts</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {total} contract{total !== 1 ? 's' : ''}
          </p>
        </div>
        {WRITE_ROLES.has(user.role ?? '') && (
          <Link href="/dashboard/contracts/new"
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}>
            + New Contract
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search contracts…"
          className="px-3 py-2 rounded-xl text-sm w-56"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All statuses</option>
          {['DRAFT','ACTIVE','UNDER_REVIEW','RENEWED','EXPIRED','TERMINATED'].map(s => (
            <option key={s} value={s}>{s.replace('_',' ')}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No contracts found</p>
          {WRITE_ROLES.has(user.role ?? '') && (
            <Link href="/dashboard/contracts/new" className="text-sm" style={{ color: '#2563eb' }}>
              Create the first contract →
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                {['Contract No', 'Entity', 'Type', 'Status', 'Value', 'Start', 'End / Renewal', 'Owner'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                    style={{ color: 'var(--muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const col  = STATUS_COLOR[r.status]
                const days = daysUntil(r.endDate)
                const expiringSoon = days !== null && days >= 0 && days <= 30

                return (
                  <tr key={r.id}
                    onClick={() => router.push(`/dashboard/contracts/${r.id}`)}
                    className="cursor-pointer transition-colors hover:bg-blue-50"
                    style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--ink)' }}>
                      {r.contractNo}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/entities/${r.entity.id}`}
                        onClick={e => e.stopPropagation()}
                        className="hover:underline" style={{ color: 'var(--ink)' }}>
                        {r.entity.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>{r.type}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: col.bg, color: col.text }}>
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--ink)' }}>
                      {fmtAmt(r.value, r.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {fmtDate(r.startDate)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span style={{ color: expiringSoon ? '#ea580c' : 'var(--muted)' }}>
                        {fmtDate(r.endDate)}
                        {expiringSoon && days !== null && (
                          <span className="ml-1 text-xs">({days}d)</span>
                        )}
                      </span>
                      {r.autoRenew && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
                          style={{ background: '#eff6ff', color: '#2563eb' }}>auto</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {r.owner.name ?? r.owner.email}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
