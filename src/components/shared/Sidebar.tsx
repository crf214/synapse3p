'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

type Role = string

interface NavItem {
  href: string
  label: string
  icon: string
  roles: Role[] | 'all'
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',                  label: 'Dashboard',       icon: '◈', roles: 'all' },
  { href: '/dashboard/invoices',         label: 'Invoices',        icon: '◎', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
  { href: '/dashboard/purchase-orders',  label: 'Purchase Orders', icon: '◻', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
  { href: '/dashboard/approvals',        label: 'Approvals',       icon: '✓', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
  { href: '/dashboard/vendors',          label: 'Vendors',         icon: '◑', roles: ['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
  { href: '/dashboard/documents',        label: 'Documents',       icon: '◧', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
  { href: '/dashboard/reports',          label: 'Reports',         icon: '◉', roles: ['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'] },
  { href: '/dashboard/settings',         label: 'Settings',        icon: '◌', roles: ['ADMIN'] },
  { href: '/portal',                     label: 'My Portal',       icon: '◐', roles: ['VENDOR', 'CLIENT'] },
]

const ROLE_LABEL: Record<string, string> = {
  ADMIN:            'Admin',
  AP_CLERK:         'AP Clerk',
  FINANCE_MANAGER:  'Finance Manager',
  CONTROLLER:       'Controller',
  CFO:              'CFO',
  VENDOR:           'Vendor',
  CLIENT:           'Client',
}

interface Props {
  user: { email: string; name?: string | null; avatar?: string | null; role?: string }
}

export default function Sidebar({ user }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  const visibleNav = NAV_ITEMS.filter(item =>
    item.roles === 'all' || (user.role ? item.roles.includes(user.role) : false)
  )

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col h-screen sticky top-0"
      style={{ borderRight: '1px solid var(--border)', background: 'var(--surface)' }}>

      {/* Logo */}
      <div className="px-6 py-6 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="font-display text-xl" style={{ color: 'var(--ink)' }}>Synapse3P</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleNav.map(item => {
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
          return (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors"
              style={{
                background: active ? '#eff6ff' : 'transparent',
                color: active ? '#2563eb' : 'var(--muted)',
                border: active ? '1px solid #2563eb22' : '1px solid transparent',
                fontWeight: active ? 500 : 400,
              }}>
              <span style={{ fontSize: 15, opacity: active ? 1 : 0.6 }}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
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
          <div className="px-3 py-1">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb22' }}>
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          </div>
        )}

        <button onClick={logout}
          className="w-full text-left px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white"
          style={{ color: 'var(--muted)' }}>
          Sign out
        </button>
      </div>
    </aside>
  )
}
