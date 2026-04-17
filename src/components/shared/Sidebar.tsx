'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: '◈', color: '#2563eb', bg: '#eff6ff' },
]

interface Props {
  user: { email: string; name?: string | null; avatar?: string | null }
}

export default function Sidebar({ user }: Props) {
  const pathname = usePathname()
  const router = useRouter()

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
        {NAV.map(item => {
          const active = pathname === item.href
          return (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors"
              style={{
                background: active ? item.bg : 'transparent',
                color: active ? item.color : 'var(--muted)',
                border: active ? `1px solid ${item.color}22` : '1px solid transparent',
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
        <button onClick={logout}
          className="w-full text-left px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white"
          style={{ color: 'var(--muted)' }}>
          Sign out
        </button>
      </div>
    </aside>
  )
}
