// src/app/api/auth/me/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

export async function GET() {
  const session = await getSession()
  if (!session.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  return NextResponse.json({
    data: { id: session.userId, email: session.email, name: session.name, orgId: session.orgId, role: session.role },
  })
}
