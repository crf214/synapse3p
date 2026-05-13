// src/app/api/portal/me/route.ts
// GET — resolve the portal user's linked entity and relationship data

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { PORTAL_ROLES } from '@/lib/security/roles'

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rel = await prisma.entityOrgRelationship.findFirst({
      where:   { portalUserId: session.userId },
      include: {
        entity: {
          select: {
            id: true, name: true,
            classifications: { select: { type: true, isPrimary: true } },
          },
        },
        org: { select: { id: true, name: true } },
      },
    })

    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    return NextResponse.json({
      entity:          rel.entity,
      org:             rel.org,
      onboardingStatus: rel.onboardingStatus,
      portalAccess:    rel.portalAccess,
      contractStart:   rel.contractStart?.toISOString() ?? null,
      contractEnd:     rel.contractEnd?.toISOString()   ?? null,
      approvedSpendLimit: rel.approvedSpendLimit,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/portal/me')
  }
}
