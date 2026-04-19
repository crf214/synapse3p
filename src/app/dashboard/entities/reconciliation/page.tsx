'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/context/UserContext'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MatchedItem {
  entityId:     string
  entityName:   string
  jurisdiction: string | null
  erpVendorId:   string
  erpVendorName: string
  erpLinkedAt:  string | null
}
interface UnmatchedSynapseItem {
  entityId:    string
  entityName:  string
  slug:        string
  jurisdiction: string | null
}
interface UnmatchedNetSuiteItem {
  erpId:   string
  erpName: string
  currency: string
}
interface ReconciliationData {
  matched:           { count: number; items: MatchedItem[]           }
  unmatchedSynapse:  { count: number; items: UnmatchedSynapseItem[]  }
  unmatchedNetsuite: { count: number; items: UnmatchedNetSuiteItem[] }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Section({
  title, count, color, children,
}: { title: string; count: number; color: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-medium" style={{ color: 'var(--ink)' }}>{title}</h2>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full tabular-nums"
          style={{ background: color + '22', color }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function ReconciliationPage() {
  const { role } = useUser()
  const router   = useRouter()

  const [data,    setData]    = useState<ReconciliationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!ALLOWED_ROLES.has(role ?? '')) { router.replace('/dashboard'); return }
    fetch('/api/entities/reconciliation')
      .then(r => r.json())
      .then(d => setData(d as ReconciliationData))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [role, router])

  if (!ALLOWED_ROLES.has(role ?? '')) return null
  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (error)   return <div className="p-8 text-sm text-red-600">{error}</div>
  if (!data)   return null

  const total = data.matched.count + data.unmatchedSynapse.count + data.unmatchedNetsuite.count

  return (
    <div className="p-8 max-w-5xl space-y-8">

      {/* Header */}
      <div>
        <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>NetSuite Reconciliation</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Match Synapse3P entities to their NetSuite vendor records
        </p>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Total',             value: total,                      bg: 'var(--surface)', color: 'var(--ink)',  border: 'var(--border)' },
          { label: 'Matched',           value: data.matched.count,          bg: '#f0fdf4',        color: '#16a34a',    border: '#16a34a22'    },
          { label: 'Unmatched (here)',  value: data.unmatchedSynapse.count, bg: '#fffbeb',        color: '#d97706',    border: '#d9770622'    },
          { label: 'Unmatched (NS)',    value: data.unmatchedNetsuite.count, bg: '#f9fafb',       color: '#6b7280',    border: '#6b728022'    },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
            <span className="text-xl font-display tabular-nums">{s.value}</span>
            <span className="text-xs">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Matched */}
      <Section title="Matched" count={data.matched.count} color="#16a34a">
        {data.matched.items.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No matched entities yet.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {data.matched.items.map((m, i) => (
              <div key={m.entityId} className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < data.matched.items.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-sm" style={{ color: '#16a34a' }}>✓</span>
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{m.entityName}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      {m.jurisdiction ?? '—'} · Linked to <span className="font-medium">{m.erpVendorName}</span> (ID: {m.erpVendorId})
                    </div>
                  </div>
                </div>
                <div className="text-xs text-right" style={{ color: 'var(--muted)' }}>
                  {fmt(m.erpLinkedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Unmatched in Synapse3P */}
      <Section title="Unmatched in Synapse3P" count={data.unmatchedSynapse.count} color="#d97706">
        {data.unmatchedSynapse.items.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>All Synapse3P entities are matched.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {data.unmatchedSynapse.items.map((m, i) => (
              <div key={m.entityId} className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < data.unmatchedSynapse.items.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{m.entityName}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{m.jurisdiction ?? '—'}</div>
                </div>
                <button
                  onClick={() => router.push(`/dashboard/entities/${m.entityId}/onboarding`)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #d9770622' }}>
                  Find match → Step 6
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Unmatched in NetSuite */}
      <Section title="Unmatched in NetSuite" count={data.unmatchedNetsuite.count} color="#6b7280">
        {data.unmatchedNetsuite.items.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>All NetSuite vendors are matched.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {data.unmatchedNetsuite.items.map((m, i) => (
              <div key={m.erpId} className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < data.unmatchedNetsuite.items.length - 1 ? '1px solid var(--border)' : undefined, background: 'var(--surface)' }}>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{m.erpName}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>ID: {m.erpId} · {m.currency}</div>
                </div>
                <button
                  onClick={() => router.push(`/dashboard/entities?name=${encodeURIComponent(m.erpName)}`)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg"
                  style={{ background: '#f9fafb', color: '#6b7280', border: '1px solid #6b728022' }}>
                  Create entity
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
