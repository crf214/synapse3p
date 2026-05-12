'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])

const OBJECT_TYPE_OPTIONS = [
  'ENTITY', 'INVOICE', 'PURCHASE_ORDER', 'PAYMENT', 'USER', 'REVIEW', 'CONTRACT',
  'DOCUMENT', 'ONBOARDING_WORKFLOW', 'ONBOARDING_INSTANCE', 'SERVICE_ENGAGEMENT',
  'PROCESSING_RULE', 'APPROVAL_WORKFLOW', 'AUTO_APPROVE_POLICY', 'EXTERNAL_SIGNAL_CONFIG',
  'REVIEW_CADENCE', 'MERGED_AUTHORIZATION', 'PAYMENT_EXECUTION',
  'BANK_ACCOUNT', 'SERVICE_CATALOGUE', 'WORKFLOW_TEMPLATE',
]

const ACTION_OPTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'SUBMIT', 'CANCEL',
  'OVERRIDE', 'COMPLETE', 'AMEND', 'SEND', 'RECONCILE', 'LOGIN', 'LOGOUT',
]

const ACTION_COLORS: Record<string, { bg: string; color: string }> = {
  CREATE:    { bg: '#f0fdf4', color: '#16a34a' },
  UPDATE:    { bg: '#eff6ff', color: '#2563eb' },
  DELETE:    { bg: '#fef2f2', color: '#dc2626' },
  APPROVE:   { bg: '#f0fdf4', color: '#16a34a' },
  REJECT:    { bg: '#fef2f2', color: '#dc2626' },
  SUBMIT:    { bg: '#eff6ff', color: '#2563eb' },
  CANCEL:    { bg: '#fef2f2', color: '#dc2626' },
  OVERRIDE:  { bg: '#fff7ed', color: '#d97706' },
  COMPLETE:  { bg: '#f0fdf4', color: '#16a34a' },
  AMEND:     { bg: '#fff7ed', color: '#d97706' },
  SEND:      { bg: '#eff6ff', color: '#2563eb' },
  RECONCILE: { bg: '#f5f3ff', color: '#7c3aed' },
  LOGIN:     { bg: '#f8fafc', color: '#475569' },
  LOGOUT:    { bg: '#f8fafc', color: '#475569' },
}

interface AuditRow {
  id:         string
  action:     string
  objectType: string
  objectId:   string
  actorId:    string | null
  actorName:  string | null
  before:     unknown
  after:      unknown
  ipAddress:  string | null
  createdAt:  string
}

interface AuditResponse {
  events: AuditRow[]
  total:  number
  page:   number
  limit:  number
}

function buildQuery(params: {
  page: number; objectType: string; action: string; objectId: string; from: string; to: string
}) {
  const q = new URLSearchParams()
  q.set('page', String(params.page))
  q.set('limit', '50')
  if (params.objectType) q.set('objectType', params.objectType)
  if (params.action)     q.set('action',     params.action)
  if (params.objectId)   q.set('objectId',   params.objectId)
  if (params.from)       q.set('from',       params.from)
  if (params.to)         q.set('to',         params.to)
  return q.toString()
}

export default function AuditLogPage() {
  const { role } = useUser()

  const [page,       setPage]       = useState(1)
  const [objectType, setObjectType] = useState('')
  const [action,     setAction]     = useState('')
  const [objectId,   setObjectId]   = useState('')
  const [fromDate,   setFromDate]   = useState('')
  const [toDate,     setToDate]     = useState('')
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())

  const queryParams = { page, objectType, action, objectId, from: fromDate, to: toDate }
  const qs          = buildQuery(queryParams)

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: queryKeys.auditLog.list(queryParams),
    queryFn:  async () => {
      const res  = await fetch(`/api/audit-log?${qs}`)
      const json = await res.json() as AuditResponse & { error?: { message: string } }
      if (!res.ok) throw new Error((json as { error?: { message: string } }).error?.message ?? 'Failed to load')
      return json
    },
  })

  if (!role || !ALLOWED_ROLES.has(role)) {
    return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Access denied.</div>
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function applyFilters() {
    setPage(1)
  }

  function clearFilters() {
    setObjectType(''); setAction(''); setObjectId(''); setFromDate(''); setToDate('')
    setPage(1)
  }

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>Audit Log</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
        Immutable record of all create, update, and delete operations across the platform.
      </p>

      {/* Filters */}
      <div className="rounded-xl border p-4 mb-6 space-y-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap gap-3">
          <select
            value={objectType}
            onChange={e => setObjectType(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)', minWidth: 180 }}
          >
            <option value="">All object types</option>
            {OBJECT_TYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>

          <select
            value={action}
            onChange={e => setAction(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)', minWidth: 140 }}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <input
            value={objectId}
            onChange={e => setObjectId(e.target.value)}
            placeholder="Object ID"
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)', width: 200 }}
          />

          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          />
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          />

          <button
            onClick={applyFilters}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}
          >
            Apply
          </button>
          <button
            onClick={clearFilters}
            className="px-4 py-2 rounded-lg text-sm border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>
      ) : !data || data.events.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
          No audit events found.
        </div>
      ) : (
        <>
          <div className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            {data.total.toLocaleString()} event{data.total !== 1 ? 's' : ''}
            {data.total > data.limit ? ` · page ${data.page} of ${totalPages}` : ''}
          </div>

          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            {/* Header */}
            <div className="grid text-xs font-medium px-4 py-2.5"
              style={{
                gridTemplateColumns: '1fr 100px 160px 200px 140px 20px',
                background: '#f8fafc',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
              }}>
              <span>Object</span>
              <span>Action</span>
              <span>Actor</span>
              <span>Object ID</span>
              <span>Time</span>
              <span />
            </div>

            {data.events.map((ev, i) => {
              const isOpen  = expanded.has(ev.id)
              const colors  = ACTION_COLORS[ev.action] ?? { bg: '#f8fafc', color: '#475569' }
              const hasData = ev.before !== null || ev.after !== null

              return (
                <div key={ev.id} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                  {/* Row */}
                  <div
                    className="grid items-center px-4 py-3 cursor-pointer hover:bg-gray-50"
                    style={{ gridTemplateColumns: '1fr 100px 160px 200px 140px 20px' }}
                    onClick={() => hasData && toggleExpand(ev.id)}
                  >
                    <span className="text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>
                      {ev.objectType.replace(/_/g, ' ')}
                    </span>

                    <span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: colors.bg, color: colors.color }}>
                        {ev.action}
                      </span>
                    </span>

                    <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                      {ev.actorName ?? ev.actorId ?? '—'}
                    </span>

                    <span className="text-xs font-mono truncate" style={{ color: 'var(--muted)', fontSize: 11 }}>
                      {ev.objectId}
                    </span>

                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {new Date(ev.createdAt).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>

                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                      {hasData ? (isOpen ? '▼' : '▶') : ''}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isOpen && hasData && (
                    <div className="px-4 pb-4 space-y-3"
                      style={{ background: '#f8fafc', borderTop: '1px solid var(--border)' }}>
                      {ev.ipAddress && (
                        <p className="text-xs pt-3" style={{ color: 'var(--muted)' }}>
                          IP: <span className="font-mono">{ev.ipAddress}</span>
                        </p>
                      )}
                      <div className="grid gap-3" style={{ gridTemplateColumns: ev.before && ev.after ? '1fr 1fr' : '1fr' }}>
                        {ev.before !== null && (
                          <div>
                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Before</p>
                            <pre className="text-xs rounded-lg p-3 overflow-auto max-h-48"
                              style={{ background: '#fff', border: '1px solid var(--border)', color: '#374151' }}>
                              {JSON.stringify(ev.before, null, 2)}
                            </pre>
                          </div>
                        )}
                        {ev.after !== null && (
                          <div>
                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>After</p>
                            <pre className="text-xs rounded-lg p-3 overflow-auto max-h-48"
                              style={{ background: '#fff', border: '1px solid var(--border)', color: '#374151' }}>
                              {JSON.stringify(ev.after, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                ← Previous
              </button>
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
