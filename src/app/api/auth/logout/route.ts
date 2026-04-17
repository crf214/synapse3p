// src/app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/session'

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ data: { ok: true } })
  const session = await getSessionFromRequest(req, res)
  session.destroy()
  return res
}
