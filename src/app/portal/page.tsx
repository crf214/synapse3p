// src/app/portal/page.tsx
import { getSession } from '@/lib/session'

export default async function PortalPage() {
  const session = await getSession()
  const name = session.name ?? session.email!

  return (
    <div className="p-8 max-w-2xl mx-auto mt-12 fade-up">
      <h1 className="font-display text-3xl mb-3" style={{ color: 'var(--ink)' }}>
        Welcome, {name}
      </h1>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Your portal is being set up. Check back soon.
      </p>
    </div>
  )
}
