'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

// Vendor-adjacent entity types
const VENDOR_TYPES = ['VENDOR','CONTRACTOR','BROKER','PLATFORM','FUND_SVC_PROVIDER','OTHER']

interface VendorRow {
  id:              string
  name:            string
  status:          string
  jurisdiction:    string | null
  primaryCurrency: string
  riskScore:       number | null
  primaryType:     string | null
  latestRiskScore: { computedScore: number; scoredAt: string } | null
  orgRelationship: { onboardingStatus: string; activeForBillPay: boolean; approvedSpendLimit: number | null } | null
  bankAccountCount: number
  engagementCount:  number
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  ACTIVE:    { bg: '#f0fdf4', text: '#16a34a' },
  INACTIVE:  { bg: '#f8fafc', text: '#64748b' },
  SUSPENDED: { bg: '#fef2f2', text: '#dc2626' },
  PENDING:   { bg: '#fff7ed', text: '#ea580c' },
}

function riskColor(score: number | null) {
  if (score === null) return 'var(--muted)'
  if (score >= 7) return '#dc2626'
  if (score >= 4) return '#ea580c'
  return '#16a34a'
}

function fmtAmt(v: number | null, currency = 'USD') {
  if (v === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v)
}

export default function VendorsPage() {
  const user   = useUser()
  const router = useRouter()

  const [rows,    setRows]    = useState<VendorRow[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [search,  setSearch]  = useState('')
  const [status,  setStatus]  = useState('')
  const [type,    setType]    = useState('')
  const [page,    setPage]    = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams({ page: String(page), limit: '50' })
    if (search) p.set('search', search)
    if (status) p.set('status', status)
    // Pass types filter — either specific type or all vendor types
    p.set('types', type || VENDOR_TYPES.join(','))
    try {
      const res = await fetch(`/api/entities?${p}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.entities)
      setTotal(data.pagination?.total ?? 0)
    } catch {
      setError('Could not load vendors.')
    } finally {
      setLoading(false)
    }
  }, [search, status, type, page])

  useEffect(() => { setPage(1) }, [search, status, type])
  useEffect(() => { load() }, [load])

  if (!ALLOWED_ROLES.has(user.role ?? '')) {
    return <div className="p-8"><p style={{ color: 'var(--muted)' }}>Access denied.</p></div>
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Vendors</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            Third-party entities — {total} total
          </p>
        </div>
        <Link href="/dashboard/entities/new"
          className="px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: '#2563eb', color: '#fff' }}>
          + New Entity
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search vendors…"
          className="px-3 py-2 rounded-xl text-sm w-56"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}
        />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All statuses</option>
          {['ACTIVE','INACTIVE','SUSPENDED','PENDING'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={type} onChange={e => setType(e.target.value)}
          className="px-3 py-2 rounded-xl text-sm"
          style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'var(--surface)' }}>
          <option value="">All types</option>
          {VENDOR_TYPES.map(t => (
            <option key={t} value={t}>{t.replace('_',' ')}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--muted)' }}>
          <p className="text-lg font-medium mb-1">No vendors found</p>
          <Link href="/dashboard/entities/new" className="text-sm" style={{ color: '#2563eb' }}>
            Add the first entity →
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Name','Type','Status','Risk','Jurisdiction','Currency','Spend Limit','Onboarding','Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wide"
                      style={{ color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const col = STATUS_COLOR[r.status] ?? { bg: '#f8fafc', text: '#64748b' }
                  const score = r.latestRiskScore?.computedScore ?? r.riskScore
                  return (
                    <tr key={r.id}
                      onClick={() => router.push(`/dashboard/entities/${r.id}`)}
                      className="cursor-pointer transition-colors hover:bg-blue-50"
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                        {r.name}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {r.primaryType?.replace('_',' ') ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: col.bg, color: col.text }}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold" style={{ color: riskColor(score) }}>
                        {score !== null ? score.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {r.jurisdiction ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {r.primaryCurrency}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                        {fmtAmt(r.orgRelationship?.approvedSpendLimit ?? null, r.primaryCurrency)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.orgRelationship ? (
                          <span className="px-2 py-0.5 rounded-full"
                            style={{
                              background: r.orgRelationship.onboardingStatus === 'COMPLETED' ? '#f0fdf4' : '#fff7ed',
                              color:      r.orgRelationship.onboardingStatus === 'COMPLETED' ? '#16a34a' : '#ea580c',
                            }}>
                            {r.orgRelationship.onboardingStatus}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <Link href={`/dashboard/entities/${r.id}`}
                            className="px-2 py-1 rounded-lg"
                            style={{ background: '#eff6ff', color: '#2563eb' }}>
                            View
                          </Link>
                          <Link href={`/dashboard/reviews?entityId=${r.id}`}
                            className="px-2 py-1 rounded-lg"
                            style={{ background: '#f1f5f9', color: '#64748b' }}>
                            Reviews
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
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
