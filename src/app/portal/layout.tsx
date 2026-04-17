// src/app/portal/layout.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import PortalNav from './PortalNav'

const PORTAL_ROLES = ['VENDOR', 'CLIENT']

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()

  if (!session.role || !PORTAL_ROLES.includes(session.role)) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--cream)' }}>
      <PortalNav name={session.name ?? session.email!} />
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
