// src/app/api/users/route.ts
// GET — list org members.
// ?roles=  filter by comma-separated roles (approver picker)
// ?admin=1  full user detail for ADMIN user management UI

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const READ_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const adminMode  = req.nextUrl.searchParams.get('admin') === '1'
    const rolesParam = req.nextUrl.searchParams.get('roles')
    const roleFilter = rolesParam
      ? rolesParam.split(',').map(r => r.trim()).filter(Boolean)
      : null

    if (adminMode) {
      if (session.role !== 'ADMIN') throw new ForbiddenError()

      const members = await prisma.orgMember.findMany({
        where: { orgId: session.orgId },
        include: {
          user: {
            select: {
              id: true, name: true, email: true, avatar: true,
              emailVerified: true, isActive: true, lastLoginAt: true, createdAt: true,
            },
          },
        },
        orderBy: { user: { name: 'asc' } },
      })

      const users = members.map(m => ({
        id:            m.userId,
        name:          m.user.name,
        email:         m.user.email,
        avatar:        m.user.avatar,
        role:          m.role,
        memberStatus:  m.status,
        emailVerified: m.user.emailVerified,
        isActive:      m.user.isActive,
        lastLoginAt:   m.user.lastLoginAt?.toISOString() ?? null,
        createdAt:     m.user.createdAt.toISOString(),
      }))

      return NextResponse.json({ users })
    }

    // Standard mode — approver picker
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
