'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@/context/UserContext'

interface Stats {
  entities: number
  invoices:       { total: number; pending: number; byStatus: Record<string, number> }
  purchaseOrders: { total: number; pending: number; byStatus: Record<string, number> }
  reviews:        { total: number; open: number; overdue: number }
  payments:       { pending: number }
  signals:        { active: number }
  ingestion:      { failures: number }
  controls:       { passRate: number | null; passCount: number; failCount: number; totalTests: number }
  recentActivity: Array<{
    id: string
    type: string
    description: string
    createdAt: string
    entity: { id: string; name: string }
  }>
}

const ACTIVITY_ICON: Record<string, string> = {
  ONBOARDING:         '◈',
  REVIEW:             '◉',
  PAYMENT:            '◎',
  STATUS_CHANGE:      '◌',
  INCIDENT:           '◆',
  DOCUMENT:           '◫',
  NOTE:               '◑',
  EXTERNAL_SIGNAL:    '◉',
  RISK_SCORE_CHANGE:  '◆',
}

function StatCard({
  label, value, sub, href, alert,
}: {
  label: string
  value: number | string
  sub?: string
  href?: string
  alert?: boolean
}) {
  const card = (
    <div className="rounded-2xl p-5 h-full transition-shadow hover:shadow-sm"
      style={{
        background: alert && Number(value) > 0 ? '#fef2f2' : '#fff',
        border: `1px solid ${alert && Number(value) > 0 ? '#fecaca' : 'var(--border)'}`,
      }}>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--muted)' }}>{label}</p>
      <p className="text-3xl font-semibold leading-none mb-1"
        style={{ color: alert && Number(value) > 0 ? '#dc2626' : 'var(--ink)' }}>
        {value}
      </p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{sub}</p>}
    </div>
  )

  return href
    ? <Link href={href} className="block h-full no-underline">{card}</Link>
    : card
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function DashboardPage() {
  const user = useUser()
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d) })
      .finally(() => setLoading(false))
  }, [])

  const role = user.role ?? ''
  const isFinance  = ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AP_CLERK'].includes(role)
  const isRisk     = ['ADMIN', 'CISO', 'LEGAL', 'CFO', 'CONTROLLER'].includes(role)
  const isAudit    = ['ADMIN', 'AUDITOR', 'CFO', 'CONTROLLER'].includes(role)

  return (
    <div className="p-8 max-w-5xl mx-auto fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl mb-1" style={{ color: 'var(--ink)' }}>
          Dashboard
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {user.name ?? user.email}
          {role && <span className="ml-2 px-2 py-0.5 rounded-full text-xs"
            style={{ background: '#f1f5f9', color: '#475569' }}>{role}</span>}
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl h-24 animate-pulse"
              style={{ background: '#f1f5f9' }} />
          ))}
        </div>
      ) : !stats ? (
        <div className="text-sm" style={{ color: 'var(--muted)' }}>Could not load stats.</div>
      ) : (
        <>
          {/* ── Stat cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-8">
            <StatCard
              label="Entities"
              value={stats.entities}
              sub="monitored third parties"
              href="/dashboard/entities"
            />

            {isFinance && (
              <StatCard
                label="Invoices Pending"
                value={stats.invoices.pending}
                sub={`${stats.invoices.total} total`}
                href="/dashboard/invoices"
                alert={stats.invoices.pending > 0}
              />
            )}

            {isFinance && (
              <StatCard
                label="POs Pending Approval"
                value={stats.purchaseOrders.pending}
                sub={`${stats.purchaseOrders.total} total`}
                href="/dashboard/purchase-orders"
                alert={stats.purchaseOrders.pending > 0}
              />
            )}

            {isFinance && (
              <StatCard
                label="Payments Queued"
                value={stats.payments.pending}
                sub="awaiting dispatch"
                href="/dashboard/payments"
                alert={stats.payments.pending > 0}
              />
            )}

            {isRisk && (
              <StatCard
                label="Active Signals"
                value={stats.signals.active}
                sub="external alerts"
                href="/dashboard/settings/external-signals"
                alert={stats.signals.active > 0}
              />
            )}

            {isRisk && (
              <StatCard
                label="Open Reviews"
                value={stats.reviews.open}
                sub={stats.reviews.overdue > 0 ? `${stats.reviews.overdue} overdue` : `${stats.reviews.total} total`}
                href="/dashboard/reviews"
                alert={stats.reviews.overdue > 0}
              />
            )}

            {isAudit && (
              <StatCard
                label="Control Pass Rate"
                value={stats.controls.passRate !== null ? `${stats.controls.passRate}%` : '—'}
                sub={stats.controls.totalTests > 0
                  ? `${stats.controls.passCount} pass / ${stats.controls.failCount} fail (30d)`
                  : 'No tests run yet'}
                href="/dashboard/controls"
                alert={stats.controls.passRate !== null && stats.controls.passRate < 80}
              />
            )}

            {isFinance && stats.ingestion.failures > 0 && (
              <StatCard
                label="Ingestion Failures"
                value={stats.ingestion.failures}
                sub="need replay"
                href="/dashboard/invoices/ingestion"
                alert
              />
            )}
          </div>

          {/* ── Two-column lower section ────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

            {/* Recent activity */}
            <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)', background: '#fff' }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Recent Activity</h2>
                <Link href="/dashboard/entities" className="text-xs hover:underline" style={{ color: '#2563eb' }}>
                  View entities →
                </Link>
              </div>
              {stats.recentActivity.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>
                  No activity yet. Start by adding an entity.
                </p>
              ) : (
                <div className="space-y-3">
                  {stats.recentActivity.map(a => (
                    <div key={a.id} className="flex items-start gap-3">
                      <span className="flex-shrink-0 text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
                        {ACTIVITY_ICON[a.type] ?? '◌'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--ink)' }}>
                          <Link href={`/dashboard/entities/${a.entity.id}`}
                            className="hover:underline" style={{ color: '#2563eb' }}>
                            {a.entity.name}
                          </Link>
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
                          {a.description}
                        </p>
                      </div>
                      <span className="flex-shrink-0 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                        {fmtDateTime(a.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="rounded-2xl p-5" style={{ border: '1px solid var(--border)', background: '#fff' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>Quick Actions</h2>
              <div className="space-y-2">
                {isFinance && (
                  <>
                    <QuickLink href="/dashboard/invoices" icon="◎" label="Review pending invoices"
                      badge={stats.invoices.pending > 0 ? stats.invoices.pending : undefined} />
                    <QuickLink href="/dashboard/purchase-orders" icon="◻" label="View purchase orders"
                      badge={stats.purchaseOrders.pending > 0 ? stats.purchaseOrders.pending : undefined} />
                    <QuickLink href="/dashboard/approvals" icon="✓" label="Approvals inbox" />
                    <QuickLink href="/dashboard/payments" icon="◈" label="Payment instructions"
                      badge={stats.payments.pending > 0 ? stats.payments.pending : undefined} />
                  </>
                )}
                {isRisk && (
                  <>
                    <QuickLink href="/dashboard/reviews" icon="◉" label="Third-party reviews"
                      badge={stats.reviews.overdue > 0 ? `${stats.reviews.overdue} overdue` : undefined} badgeAlert />
                    <QuickLink href="/dashboard/settings/external-signals" icon="◉" label="External signals"
                      badge={stats.signals.active > 0 ? stats.signals.active : undefined} badgeAlert />
                  </>
                )}
                {isAudit && (
                  <>
                    <QuickLink href="/dashboard/controls" icon="◆" label="Controls framework" />
                    <QuickLink href="/dashboard/audit-periods" icon="◈" label="Audit periods" />
                  </>
                )}
                <QuickLink href="/dashboard/entities" icon="◑" label="Entity registry" />
                <QuickLink href="/dashboard/reports" icon="◉" label="Reports" />
              </div>
            </div>

          </div>

          {/* ── Invoice status breakdown (finance only) ─────────────────── */}
          {isFinance && stats.invoices.total > 0 && (
            <div className="mt-6 rounded-2xl p-5"
              style={{ border: '1px solid var(--border)', background: '#fff' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>
                Invoice Pipeline
              </h2>
              <div className="flex flex-wrap gap-3">
                {Object.entries(stats.invoices.byStatus).map(([status, count]) => (
                  <Link key={status} href={`/dashboard/invoices?status=${status}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs hover:opacity-80 transition-opacity"
                    style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
                    <span className="font-medium" style={{ color: 'var(--ink)' }}>{count}</span>
                    <span style={{ color: 'var(--muted)' }}>
                      {status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function QuickLink({
  href, icon, label, badge, badgeAlert,
}: {
  href: string
  icon: string
  label: string
  badge?: number | string
  badgeAlert?: boolean
}) {
  return (
    <Link href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:opacity-80 transition-opacity"
      style={{ background: '#f8fafc', border: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--muted)' }}>{icon}</span>
      <span className="flex-1" style={{ color: 'var(--ink)' }}>{label}</span>
      {badge !== undefined && (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={{
            background: badgeAlert ? '#fef2f2' : '#eff6ff',
            color:      badgeAlert ? '#dc2626'  : '#2563eb',
          }}>
          {badge}
        </span>
      )}
    </Link>
  )
}
