import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN'])

export async function POST(
  _req: Request,
  { params }: { params: { periodId: string } },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const period = await prisma.auditPeriod.findFirst({
      where: { id: params.periodId, orgId: session.orgId },
    })
    if (!period) throw new NotFoundError('Audit period not found')

    if (period.status === 'LOCKED') {
      throw new ValidationError('Audit period is already locked')
    }

    if (period.status !== 'CLOSED') {
      throw new ValidationError(
        `Audit period must be CLOSED before it can be locked (current status: ${period.status})`
      )
    }

    // Once locked: no new test results or evidence can be added to this period.
    // Enforcement is at the application layer — routes that write ControlTestResult or
    // ControlEvidence must check the period status before inserting.
    const updated = await prisma.auditPeriod.update({
      where: { id: params.periodId },
      data: {
        status:   'LOCKED',
        lockedBy: session.userId,
        lockedAt: new Date(),
      },
    })

    return NextResponse.json({ period: updated })
  } catch (err) {
    return handleApiError(err, `POST /api/audit-periods/${params.periodId}/lock`)
  }
}
