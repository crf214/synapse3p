// src/app/api/auth/logout/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { writeAuditEvent } from '@/lib/audit'

export async function POST() {
  const session = await getSession()
  const userId = session.userId
  const orgId  = session.orgId
  session.destroy()
  if (userId) {
    await writeAuditEvent(prisma, {
      actorId:    userId,
      orgId:      orgId ?? '',
      action:     'LOGOUT',
      objectType: 'USER',
      objectId:   userId,
    })
  }
  return NextResponse.json({ data: { ok: true } })
}
