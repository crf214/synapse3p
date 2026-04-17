// src/app/dashboard/layout.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import Sidebar from '@/components/shared/Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session.userId) redirect('/auth/login')

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, name: true, avatar: true },
  })

  return (
    <div className="flex min-h-screen">
      <Sidebar user={{ email: user?.email ?? session.email!, name: user?.name, avatar: user?.avatar }} />
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
