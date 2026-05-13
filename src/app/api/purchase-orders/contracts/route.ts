// src/app/api/purchase-orders/contracts/route.ts
// GET — list active contracts for an entity (used by PO create/edit form selectors)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { FINANCE_ROLES } from '@/lib/security/roles'

const READ_ROLES = FINANCE_ROLES

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const entityId = sanitiseString(req.nextUrl.searchParams.get('entityId') ?? '', 50).trim()
    if (!entityId) throw new ValidationError('entityId is required')

    const contracts = await prisma.contract.findMany({
      where: {
        orgId:    session.orgId,
        entityId,
        status:   'ACTIVE',
      },
      select: {
        id:         true,
        contractNo: true,
        type:       true,
        status:     true,
        value:      true,
        currency:   true,
        startDate:  true,
        endDate:    true,
      },
      orderBy: { startDate: 'desc' },
      take: 50,
    })

    return NextResponse.json({ contracts })
  } catch (err) {
    return handleApiError(err, 'GET /api/purchase-orders/contracts')
  }
}
