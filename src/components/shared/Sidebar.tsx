'use client'
import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AppTheme, APP_THEMES, getAppFromPath } from '@/lib/apps'

type Role = string

// ─── Nav item types ──────────────────────────────────────────────────────────

interface NavLeaf {
  type?:  never
  href:   string
  label:  string
  icon:   string
  roles:  Role[] | 'all'
}

// A group with navigable children (used within app sections)
interface NavGroup {
  type:     'group'
  href?:    string
  label:    string
  icon:     string
  roles:    Role[] | 'all'
  children: NavLeaf[]
}

type AppNavItem = NavLeaf | NavGroup

// A named sub-category within Global Settings (toggle-only, two-level nesting)
interface SettingsCategory {
  label:    string
  icon:     string
  roles:    Role[] | 'all'
  children: NavLeaf[]
}

// ─── App section definitions ─────────────────────────────────────────────────

interface AppSection {
  appId:  'entity' | 'invoice' | 'payment'
  items:  AppNavItem[]
}

const ENTITY_SECTION: AppSection = {
  appId: 'entity',
  items: [
    {
      type:  'group',
      href:  '/dashboard/entities',
      label: 'Entities',
      icon:  '◑',
      roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR', 'LEGAL', 'CISO'],
      children: [
        { href: '/dashboard/entities', label: 'On/Off Boarding', icon: '◎', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR', 'LEGAL', 'CISO'] },
        { href: '/dashboard/vendors',  label: 'Vendors',         icon: '◑', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'] },
      ],
    },
    { href: '/dashboard/reviews',   label: 'Reviews',              icon: '◉', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'] },
    { href: '/dashboard/contracts', label: 'Contracts & Documents', icon: '◧', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'AUDITOR'] },
  ],
}

const INVOICE_SECTION: AppSection = {
  appId: 'invoice',
  items: [
    {
      type:  'group',
      href:  '/dashboard/invoices',
      label: 'Invoices',
      icon:  '◎',
      roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'],
      children: [
        { href: '/dashboard/invoices/ingestion',  label: 'Ingestion Monitor', icon: '◫', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
        { href: '/dashboard/invoices/quarantine', label: 'Quarantine',        icon: '◈', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
        { href: '/dashboard/invoices/recurring',  label: 'Recurring',         icon: '◉', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
      ],
    },
    { href: '/dashboard/purchase-orders',     label: 'Purchase Orders',     icon: '◻', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
    { href: '/dashboard/service-engagements', label: 'Service Engagements', icon: '◇', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
    { href: '/dashboard/approvals',           label: 'Approvals',           icon: '◉', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
  ],
}

const PAYMENT_SECTION: AppSection = {
  appId: 'payment',
  items: [
    {
      type:  'group',
      href:  '/dashboard/payments',
      label: 'Payments',
      icon:  '◈',
      roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'],
      children: [
        { href: '/dashboard/payments/executions', label: 'Executions', icon: '◉', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
      ],
    },
    { href: '/dashboard/entities/reconciliation', label: 'Reconciliation', icon: '◎', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'] },
  ],
}

const ALL_APP_SECTIONS: AppSection[] = [ENTITY_SECTION, INVOICE_SECTION, PAYMENT_SECTION]

// ─── Global Settings definition ──────────────────────────────────────────────

const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    label: 'Entity Settings',
    icon:  '◑',
    roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'],
    children: [
      { href: '/dashboard/settings/onboarding-workflows', label: 'Onboarding Workflows', icon: '◫', roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'] },
      { href: '/dashboard/settings/external-signals',     label: 'External Signals',     icon: '◉', roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'] },
      { href: '/dashboard/settings/review-cadences',      label: 'Review Cadences',      icon: '◉', roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'] },
    ],
  },
  {
    label: 'Invoice Settings',
    icon:  '◎',
    roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'],
    children: [
      { href: '/dashboard/settings/service-catalogue',     label: 'Service Catalogue',    icon: '◇', roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'] },
      { href: '/dashboard/settings/processing-rules',      label: 'Processing Rules',     icon: '◈', roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'] },
      { href: '/dashboard/settings/auto-approve-policies', label: 'Auto-Approve',         icon: '◉', roles: ['ADMIN', 'CFO', 'CONTROLLER'] },
    ],
  },
  {
    label: 'Workflow Rules & Processes',
    icon:  '◫',
    roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER'],
    children: [
      { href: '/dashboard/settings/workflow-templates', label: 'Workflow Templates',  icon: '◫', roles: ['ADMIN', 'FINANCE_MANAGER'] },
      { href: '/dashboard/settings/approval-workflows', label: 'Approval Workflows',  icon: '◉', roles: ['ADMIN'] },
    ],
  },
  {
    label: 'Compliance',
    icon:  '◆',
    roles: ['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'],
    children: [
      { href: '/dashboard/settings/audit-log', label: 'Audit Log', icon: '◈', roles: ['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'] },
    ],
  },
  {
    label: 'Users & Access',
    icon:  '◐',
    roles: ['ADMIN'],
    children: [
      { href: '/dashboard/settings/users', label: 'Users', icon: '◐', roles: ['ADMIN'] },
    ],
  },
  {
    label: 'Other Settings',
    icon:  '⚙',
    roles: ['ADMIN', 'CFO', 'CONTROLLER', 'FINANCE_MANAGER', 'FINANCE_MANAGER'],
    children: [
      { href: '/dashboard/profile', label: 'Profile', icon: '◐', roles: 'all' },
    ],
  },
]

// ─── Role labels ─────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  ADMIN:           'Admin',
  AP_CLERK:        'AP Clerk',
  FINANCE_MANAGER: 'Finance Manager',
  CONTROLLER:      'Controller',
  CFO:             'CFO',
  VENDOR:          'Vendor',
  CLIENT:          'Client',
  AUDITOR:         'Auditor',
  LEGAL:           'Legal',
  CISO:            'CISO',
}

interface Props {
  user: { email: string; name?: string | null; avatar?: string | null; role?: string }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

function sectionIsActive(pathname: string, appId: string): boolean {
  return getAppFromPath(pathname) === appId
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Sidebar({ user }: Props) {
  const pathname = usePathname()
  const router   = useRouter()

  const activeAppId = getAppFromPath(pathname)

  // App section open states
  const [entityOpen,   setEntityOpen]   = useState(activeAppId === 'entity')
  const [invoiceOpen,  setInvoiceOpen]  = useState(activeAppId === 'invoice')
  const [paymentOpen,  setPaymentOpen]  = useState(activeAppId === 'payment')
  const [settingsOpen, setSettingsOpen] = useState(activeAppId === 'settings')

  // Group open states (keyed by href or label) — covers app groups + settings categories
  const buildInitialGroupOpen = () => {
    const map: Record<string, boolean> = {}
    for (const section of ALL_APP_SECTIONS) {
      for (const item of section.items) {
        if (item.type === 'group' && item.href) {
          map[item.href] = isActivePath(pathname, item.href) ||
            (item.children ?? []).some(c => isActivePath(pathname, c.href))
        }
      }
    }
    for (const cat of SETTINGS_CATEGORIES) {
      map[cat.label] = cat.children.some(c => isActivePath(pathname, c.href))
    }
    return map
  }
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(buildInitialGroupOpen)

  function toggleGroup(key: string) {
    setGroupOpen(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function isVisible(roles: Role[] | 'all'): boolean {
    return roles === 'all' || (user.role ? roles.includes(user.role) : false)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/auth/login')
    router.refresh()
  }

  function appSectionOpenState(appId: 'entity' | 'invoice' | 'payment'): [boolean, () => void] {
    if (appId === 'entity')  return [entityOpen,  () => setEntityOpen(o => !o)]
    if (appId === 'invoice') return [invoiceOpen, () => setInvoiceOpen(o => !o)]
    return [paymentOpen, () => setPaymentOpen(o => !o)]
  }

  // ── Render a leaf nav link ────────────────────────────────────────────────

  function renderLeaf(item: NavLeaf, theme: AppTheme, indent = false) {
    if (!isVisible(item.roles)) return null
    const active = isActivePath(pathname, item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        className="flex items-center gap-2.5 rounded-xl text-xs transition-colors"
        style={{
          padding:    indent ? '7px 12px' : '9px 12px',
          background: active ? theme.soft   : 'transparent',
          color:      active ? theme.text   : 'var(--muted)',
          border:     active ? `1px solid ${theme.border}` : '1px solid transparent',
          fontWeight: active ? 500 : 400,
        }}
      >
        <span className="w-4 text-center flex-shrink-0" style={{ fontSize: 11, opacity: active ? 1 : 0.5 }}>
          {item.icon}
        </span>
        <span className="text-left">{item.label}</span>
      </Link>
    )
  }

  // ── Render a nav group (with optional top-level href + children) ──────────

  function renderGroup(item: NavGroup, theme: AppTheme) {
    if (!isVisible(item.roles)) return null
    const key         = item.href ?? item.label
    const open        = groupOpen[key] ?? false
    const childActive = (item.children ?? []).some(c => isActivePath(pathname, c.href))
    const selfActive  = item.href ? isActivePath(pathname, item.href) : false
    const groupActive = selfActive || childActive

    if (item.href) {
      return (
        <div key={key}>
          <div className="flex items-center rounded-xl transition-colors"
            style={{
              background: groupActive ? theme.soft : 'transparent',
              border:     groupActive ? `1px solid ${theme.border}` : '1px solid transparent',
            }}>
            <Link href={item.href}
              className="flex items-center gap-2.5 flex-1 pl-3 py-2.5 text-xs min-w-0"
              style={{
                color:          groupActive ? theme.text : 'var(--muted)',
                fontWeight:     selfActive ? 500 : (groupActive ? 500 : 400),
                textDecoration: 'none',
              }}>
              <span className="w-4 text-center flex-shrink-0" style={{ fontSize: 13, opacity: groupActive ? 1 : 0.6 }}>
                {item.icon}
              </span>
              <span className="text-left truncate text-sm">{item.label}</span>
            </Link>
            <button type="button" onClick={() => toggleGroup(key)}
              className="pr-3 py-2.5 flex-shrink-0"
              style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
              aria-label={open ? 'Collapse' : 'Expand'}>
              <span style={{ fontSize: 14, fontWeight: 700, color: theme.accent, opacity: open ? 1 : 0.6 }}>
                {open ? '▼' : '▶'}
              </span>
            </button>
          </div>
          {open && (
            <div className="mt-0.5 ml-3 pl-3 space-y-0.5"
              style={{ borderLeft: `1px solid ${theme.border}` }}>
              {(item.children ?? []).map(child => renderLeaf(child, theme, true))}
            </div>
          )}
        </div>
      )
    }

    // Toggle-only group (no href)
    return (
      <div key={key}>
        <button type="button" onClick={() => toggleGroup(key)}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors"
          style={{
            background: groupActive && !open ? theme.soft : 'transparent',
            color:      groupActive ? theme.text : 'var(--muted)',
            border:     groupActive && !open ? `1px solid ${theme.border}` : '1px solid transparent',
            fontWeight: groupActive ? 500 : 400,
            cursor:     'pointer',
          }}>
          <span className="w-4 text-center flex-shrink-0" style={{ fontSize: 13, opacity: groupActive ? 1 : 0.6 }}>
            {item.icon}
          </span>
          <span className="flex-1 text-left">{item.label}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: theme.accent, opacity: open ? 1 : 0.6 }}>
            {open ? '▼' : '▶'}
          </span>
        </button>
        {open && (
          <div className="mt-0.5 ml-3 pl-3 space-y-0.5"
            style={{ borderLeft: `1px solid ${theme.border}` }}>
            {(item.children ?? []).map(child => renderLeaf(child, theme, true))}
          </div>
        )}
      </div>
    )
  }

  // ── Render a colored app section ──────────────────────────────────────────

  function renderAppSection(section: AppSection) {
    const theme  = APP_THEMES[section.appId]
    const active = sectionIsActive(pathname, section.appId)
    const [open, toggle] = appSectionOpenState(section.appId)

    const hasVisible = section.items.some(item =>
      item.type === 'group' ? isVisible(item.roles) : isVisible((item as NavLeaf).roles)
    )
    if (!hasVisible) return null

    return (
      <div key={section.appId} className="mb-1">
        <button type="button" onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-2 mb-1 rounded-xl text-xs transition-all"
          style={{
            borderLeft:   `3px solid ${active || open ? theme.accent : 'transparent'}`,
            borderTop:    '1px solid transparent',
            borderRight:  '1px solid transparent',
            borderBottom: '1px solid transparent',
            background:   active || open ? theme.soft : 'transparent',
            color:        active || open ? theme.text : 'var(--muted)',
            fontWeight:   active ? 700 : 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}>
          <span style={{ fontSize: 12, opacity: active || open ? 1 : 0.5 }}>{theme.icon}</span>
          <span className="flex-1 text-left">{theme.name}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: active || open ? theme.accent : 'var(--muted)', opacity: open ? 1 : 0.6 }}>
            {open ? '▼' : '▶'}
          </span>
        </button>

        {open && (
          <div className="space-y-0.5 pl-1">
            {section.items.map(item =>
              item.type === 'group'
                ? renderGroup(item as NavGroup, theme)
                : renderLeaf(item as NavLeaf, theme)
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render Global Settings section ────────────────────────────────────────

  function renderSettingsSection() {
    const theme  = APP_THEMES.settings
    const active = sectionIsActive(pathname, 'settings')
    const open   = settingsOpen

    // Only show categories the user has access to that have visible children
    const visibleCategories = SETTINGS_CATEGORIES.filter(cat =>
      isVisible(cat.roles) && cat.children.some(c => isVisible(c.roles))
    )
    if (visibleCategories.length === 0) return null

    return (
      <div className="mb-1">
        {/* Section header */}
        <button type="button" onClick={() => setSettingsOpen(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 mb-1 rounded-xl text-xs transition-all"
          style={{
            borderLeft:   `3px solid ${active || open ? theme.accent : 'transparent'}`,
            borderTop:    '1px solid transparent',
            borderRight:  '1px solid transparent',
            borderBottom: '1px solid transparent',
            background:   active || open ? theme.soft : 'transparent',
            color:        active || open ? theme.text : 'var(--muted)',
            fontWeight:   active ? 700 : 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}>
          <span style={{ fontSize: 12, opacity: active || open ? 1 : 0.5 }}>{theme.icon}</span>
          <span className="flex-1 text-left">{theme.name}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: active || open ? theme.accent : 'var(--muted)', opacity: open ? 1 : 0.6 }}>
            {open ? '▼' : '▶'}
          </span>
        </button>

        {open && (
          <div className="space-y-0.5 pl-1">
            {visibleCategories.map(cat => {
              const catOpen    = groupOpen[cat.label] ?? false
              const childActive = cat.children.some(c => isActivePath(pathname, c.href))

              return (
                <div key={cat.label}>
                  {/* Sub-category header — toggle only, slightly indented */}
                  <button type="button" onClick={() => toggleGroup(cat.label)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors"
                    style={{
                      background: childActive && !catOpen ? theme.soft : 'transparent',
                      color:      childActive ? theme.text : 'var(--muted)',
                      border:     childActive && !catOpen ? `1px solid ${theme.border}` : '1px solid transparent',
                      fontWeight: childActive ? 600 : 500,
                      cursor:     'pointer',
                    }}>
                    <span className="w-4 text-center flex-shrink-0" style={{ fontSize: 11, opacity: childActive ? 1 : 0.5 }}>
                      {cat.icon}
                    </span>
                    <span className="flex-1 text-left">{cat.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: childActive ? theme.accent : 'var(--muted)', opacity: catOpen ? 1 : 0.55 }}>
                      {catOpen ? '▼' : '▶'}
                    </span>
                  </button>

                  {/* Sub-category children */}
                  {catOpen && (
                    <div className="mt-0.5 ml-3 pl-3 space-y-0.5"
                      style={{ borderLeft: `1px solid ${theme.border}` }}>
                      {cat.children.map(child => renderLeaf(child, theme, true))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Render a platform-level nav link (neutral slate) ──────────────────────

  function renderPlatformLink(href: string, label: string, icon: string, roles: Role[] | 'all') {
    if (!isVisible(roles)) return null
    const active = isActivePath(pathname, href)
    return (
      <Link key={href} href={href}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors"
        style={{
          background: active ? '#f1f5f9' : 'transparent',
          color:      active ? '#334155' : 'var(--muted)',
          border:     active ? '1px solid rgba(71,85,105,0.13)' : '1px solid transparent',
          fontWeight: active ? 500 : 400,
        }}>
        <span className="w-5 text-center flex-shrink-0" style={{ fontSize: 14, opacity: active ? 1 : 0.55 }}>
          {icon}
        </span>
        <span className="text-left">{label}</span>
      </Link>
    )
  }

  // ── Full render ───────────────────────────────────────────────────────────

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col h-screen sticky top-0"
      style={{ borderRight: '1px solid var(--border)', background: 'var(--surface)' }}>

      {/* Logo */}
      <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="font-display text-xl" style={{ color: 'var(--ink)' }}>Synapse3P</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">

        {/* Dashboard */}
        {renderPlatformLink('/dashboard', 'Dashboard', '◈', 'all')}

        <div className="my-2" style={{ borderTop: '1px solid var(--border)' }} />

        {/* App sections */}
        {ALL_APP_SECTIONS.map(section => renderAppSection(section))}

        <div className="my-2" style={{ borderTop: '1px solid var(--border)' }} />

        {/* Global Settings */}
        {renderSettingsSection()}

        <div className="my-2" style={{ borderTop: '1px solid var(--border)' }} />

        {/* Platform */}
        {renderPlatformLink('/dashboard/controls',      'Controls',      '◆', ['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])}
        {renderPlatformLink('/dashboard/audit-periods', 'Audit Periods', '◈', ['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])}

        <div className="my-2" style={{ borderTop: '1px solid var(--border)' }} />

        {renderPlatformLink('/dashboard/help', 'Help & Glossary', '?', 'all')}

      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <Link href="/dashboard/profile"
          className="flex items-center gap-3 px-3 py-2 rounded-xl transition-colors hover:bg-white">
          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-medium"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
            {user.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              : (user.name ?? user.email).charAt(0).toUpperCase()
            }
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
              {user.name ?? user.email}
            </div>
            {user.name && (
              <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>{user.email}</div>
            )}
          </div>
        </Link>

        {user.role && (
          <div className="px-3 pt-1 pb-2">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: '#f1f5f9', color: '#334155', border: '1px solid rgba(71,85,105,0.13)' }}>
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          </div>
        )}

        <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={logout}
            className="w-full text-left px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white"
            style={{ color: 'var(--muted)' }}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
