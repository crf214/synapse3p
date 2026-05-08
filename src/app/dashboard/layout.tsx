// src/app/dashboard/layout.tsx
import { getSession } from '@/lib/session'
import Sidebar from '@/components/shared/Sidebar'
import { UserProvider } from '@/context/UserContext'
import { AppThemeBar } from '@/components/shared/AppThemeBar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()

  return (
    <UserProvider
      id={session.userId!}
      email={session.email!}
      name={session.name}
      avatar={session.avatar}
      orgId={session.orgId}
      role={session.role}
    >
      <div className="flex min-h-screen">
        <Sidebar
          user={{
            email: session.email!,
            name: session.name,
            avatar: session.avatar,
            role: session.role,
          }}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <AppThemeBar />
          <main className="flex-1 min-w-0 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </UserProvider>
  )
}
