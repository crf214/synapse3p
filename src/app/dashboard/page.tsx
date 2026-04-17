import { getSession } from '@/lib/session'

export default async function DashboardPage() {
  const session = await getSession()

  return (
    <div className="p-8 max-w-4xl fade-up">
      <h1 className="font-display text-3xl mb-2" style={{ color: 'var(--ink)' }}>
        Welcome to Synapse3P
      </h1>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Signed in as {session.email}
      </p>
    </div>
  )
}
