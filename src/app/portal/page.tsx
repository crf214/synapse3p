// src/app/portal/page.tsx — portal home / dashboard
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import PortalHome from './PortalHome'

export default async function PortalPage() {
  const session = await getSession()
  if (!session.userId) redirect('/auth/login')
  return <PortalHome name={session.name ?? session.email ?? ''} role={session.role ?? ''} />
}
