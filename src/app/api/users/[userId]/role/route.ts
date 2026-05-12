// PUT /api/users/[userId]/role — ADMIN only
// Changes a user's role in OrgMember + User, sets roleChangedAt to invalidate stale sessions.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'

const VALID_ROLES = ['ADMIN','AP_CLERK','FINANCE_MANAGER','CONTROLLER','CFO','AUDITOR','LEGAL','CISO'] as const
const Schema = z.object({ role: z.enum(VALID_ROLES) })

type RouteParams = { params: Promise<{ userId: string }> }

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { userId } = await params

    if (userId === session.userId) {
      return NextResponse.json(
        { error: { message: 'You cannot change your own role' } },
        { status: 400 },
      )
    }

    const member = await prisma.orgMember.findUnique({
      where:   { orgId_userId: { orgId: session.orgId, userId } },
      select:  { id: true, role: true },
    })
    if (!member) throw new NotFoundError('User not found in this organisation')

    const body   = await req.json()
    const parsed = Schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { message: parsed.error.issues[0]?.message ?? 'Invalid role' } },
        { status: 400 },
      )
    }
    const { role } = parsed.data
    const previousRole = member.role

    const now = new Date()

    await prisma.$transaction([
      prisma.orgMember.update({
        where: { orgId_userId: { orgId: session.orgId, userId } },
        data:  { role: role as never },
      }),
      prisma.user.update({
        where: { id: userId },
        data:  { role: role as never, roleChangedAt: now },
      }),
    ])

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      session.orgId,
      action:     'UPDATE',
      objectType: 'USER',
      objectId:   userId,
      before:     { role: previousRole },
      after:      { role },
    })

    return NextResponse.json({ ok: true, role })
  } catch (err) {
    return handleApiError(err, 'PUT /api/users/[userId]/role')
  }
}
