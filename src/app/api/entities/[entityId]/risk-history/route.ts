import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { FINANCE_ROLES } from '@/lib/security/roles'

const READ_ROLES = FINANCE_ROLES

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const history = await prisma.entityRiskScore.findMany({
      where:   { entityId },
      orderBy: { computedAt: 'desc' },
      take:    20,
    })

    return NextResponse.json({ history })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/risk-history')
  }
}
