'use client'
import { useRouter } from 'next/navigation'

export default function PortalNav({ name }: { name: string }) {
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <header className="flex items-center justify-between px-8 py-4 border-b"
      style={{ borderColor: 'var(--border)', background: '#fff' }}>
      <span className="font-display text-xl" style={{ color: 'var(--ink)' }}>Synapse3P</span>
      <div className="flex items-center gap-4">
        <span className="text-sm" style={{ color: 'var(--muted)' }}>{name}</span>
        <button onClick={logout}
          className="text-sm px-4 py-1.5 rounded-xl transition-colors"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: '#fff' }}>
          Sign out
        </button>
      </div>
    </header>
  )
}
