// src/app/api/users/route.ts
// GET — list org members, optionally filtered by role.
// Used by the invoice routing UI to populate the approver selector.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const READ_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const rolesParam = req.nextUrl.searchParams.get('roles')
    const roleFilter = rolesParam
      ? rolesParam.split(',').map(r => r.trim()).filter(Boolean)
      : null

    const members = await prisma.orgMember.findMany({
      where: {
        orgId:  session.orgId,
        status: 'active',
        ...(roleFilter?.length ? { role: { in: roleFilter as never[] } } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { user: { name: 'asc' } },
    })

    const users = members.map(m => ({
      id:     m.userId,
      name:   m.user.name,
      email:  m.user.email,
      avatar: m.user.avatar,
      role:   m.role,
    }))

    return NextResponse.json({ users })
  } catch (err) {
    return handleApiError(err, 'GET /api/users')
  }
}
