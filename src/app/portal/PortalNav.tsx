'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/portal',           label: 'Overview'  },
  { href: '/portal/invoices',  label: 'Invoices'  },
  { href: '/portal/payments',  label: 'Payments'  },
  { href: '/portal/documents', label: 'Documents' },
]

export default function PortalNav({ name }: { name: string }) {
  const router   = useRouter()
  const pathname = usePathname()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <header className="border-b" style={{ borderColor: 'var(--border)', background: '#fff' }}>
      <div className="flex items-center justify-between px-8 py-4">
        <Link href="/portal" className="font-display text-xl" style={{ color: 'var(--ink)' }}>
          Synapse3P
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: 'var(--muted)' }}>{name}</span>
          <button onClick={logout}
            className="text-sm px-4 py-1.5 rounded-xl transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: '#fff' }}>
            Sign out
          </button>
        </div>
      </div>
      <nav className="flex gap-1 px-8 pb-0">
        {NAV.map(({ href, label }) => {
          const active = href === '/portal' ? pathname === '/portal' : pathname.startsWith(href)
          return (
            <Link key={href} href={href}
              className="px-3 py-2 text-sm font-medium border-b-2 transition-colors"
              style={{
                borderColor: active ? '#2563eb' : 'transparent',
                color:       active ? '#2563eb' : 'var(--muted)',
              }}>
              {label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
