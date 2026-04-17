// src/lib/session.ts
import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { sessionOptions } from '@/lib/session-config'

export { sessionOptions }

export interface SessionData {
  userId?: string
  email?: string
  name?: string | null
  orgId?: string
  role?: string
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(cookies(), sessionOptions)
}

export async function getSessionFromRequest(
  req: NextRequest,
  res: NextResponse
): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(req, res, sessionOptions)
}

export async function requireAuth(): Promise<SessionData & { userId: string }> {
  const session = await getSession()
  if (!session.userId) {
    throw new Error('Unauthorized')
  }
  return session as SessionData & { userId: string }
}
