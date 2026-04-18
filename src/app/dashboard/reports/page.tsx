import { getSession } from '@/lib/session'
import Link from 'next/link'

const FINANCE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

interface ReportCard {
  href:        string
  title:       string
  description: string
  icon:        string
  restricted:  boolean
}

const CARDS: ReportCard[] = [
  {
    href:        '/dashboard/reports/ap-aging',
    title:       'AP Aging & Payment Queue',
    description: 'Outstanding invoices bucketed by age per currency, plus live payment instruction status.',
    icon:        '◎',
    restricted:  false,
  },
  {
    href:        '/dashboard/reports/spend',
    title:       'Spend by Vendor',
    description: 'Invoice spend grouped by vendor and currency with USD equivalents for any date range.',
    icon:        '◉',
    restricted:  false,
  },
  {
    href:        '/dashboard/reports/risk',
    title:       'Risk Dashboard',
    description: 'Entity risk scores, overdue reviews, pending onboarding, and active critical signals.',
    icon:        '◈',
    restricted:  true,
  },
  {
    href:        '/dashboard/reports/workload',
    title:       'Workload Analysis',
    description: 'Pending approvals, amendment reviews, and overdue tasks per team member.',
    icon:        '◑',
    restricted:  true,
  },
]

export default async function ReportsPage() {
  const session = await getSession()
  const role    = session.role ?? ''
  const isFinance = FINANCE_ROLES.has(role)

  const visibleCards = CARDS.filter(c => !c.restricted || isFinance)

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl mb-1" style={{ color: 'var(--ink)' }}>
          Reports
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Pre-computed snapshots refresh every 30–60 minutes. Payment queue is always live.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visibleCards.map(card => (
          <div
            key={card.href}
            className="rounded-2xl p-6 flex flex-col gap-4"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl" style={{ color: '#2563eb' }}>{card.icon}</span>
              <div>
                <div className="font-medium text-sm" style={{ color: 'var(--ink)' }}>
                  {card.title}
                </div>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {card.description}
                </p>
              </div>
            </div>
            <Link
              href={card.href}
              className="self-start text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}
            >
              View report →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
