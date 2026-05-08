import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER'])

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ periodId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { periodId } = await params
    const period = await prisma.auditPeriod.findFirst({
      where: { id: periodId, orgId: session.orgId },
    })
    if (!period) throw new NotFoundError('Audit period not found')

    if (period.status !== 'OPEN') {
      throw new ValidationError(`Cannot close a period with status ${period.status}`)
    }

    if (new Date() < period.periodEnd) {
      throw new ValidationError(
        `Period end date has not passed (ends ${period.periodEnd.toISOString().slice(0, 10)}) — cannot close early`
      )
    }

    const updated = await prisma.auditPeriod.update({
      where: { id: periodId },
      data: {
        status:   'CLOSED',
        closedBy: session.userId,
        closedAt: new Date(),
      },
    })

    return NextResponse.json({ period: updated })
  } catch (err) {
    return handleApiError(err, 'POST /api/audit-periods/[periodId]/close')
  }
}
