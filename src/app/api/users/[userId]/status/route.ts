// PUT /api/users/[userId]/status — ADMIN only
// Activates or deactivates a user account.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'

const Schema = z.object({ isActive: z.boolean() })

type RouteParams = { params: Promise<{ userId: string }> }

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { userId } = await params

    if (userId === session.userId) {
      return NextResponse.json(
        { error: { message: 'You cannot deactivate your own account' } },
        { status: 400 },
      )
    }

    const member = await prisma.orgMember.findUnique({
      where:  { orgId_userId: { orgId: session.orgId, userId } },
      select: { id: true },
    })
    if (!member) throw new NotFoundError('User not found in this organisation')

    const body   = await req.json()
    const parsed = Schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: { message: 'isActive must be a boolean' } },
        { status: 400 },
      )
    }
    const { isActive } = parsed.data

    await prisma.user.update({ where: { id: userId }, data: { isActive } })

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      session.orgId,
      action:     'UPDATE',
      objectType: 'USER',
      objectId:   userId,
      after:      { isActive },
    })

    return NextResponse.json({ ok: true, isActive })
  } catch (err) {
    return handleApiError(err, 'PUT /api/users/[userId]/status')
  }
}
