import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateAuditPeriodSchema = z.object({
  name:        z.string().min(1),
  framework:   z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd:   z.string().min(1),
})

const READ_ROLES  = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER'])

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const periods = await prisma.auditPeriod.findMany({
      where:   { orgId: session.orgId },
      orderBy: { periodStart: 'desc' },
      include: {
        _count: {
          select: { testResults: true, evidence: true },
        },
      },
    })

    return NextResponse.json({ periods, total: periods.length })
  } catch (err) {
    return handleApiError(err, 'GET /api/audit-periods')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreateAuditPeriodSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const name        = sanitiseString(body.name,      200)
    const framework   = sanitiseString(body.framework, 50)
    const periodStart = new Date(body.periodStart)
    const periodEnd   = new Date(body.periodEnd)

    if (isNaN(periodStart.getTime())) throw new ValidationError('valid periodStart is required')
    if (isNaN(periodEnd.getTime()))   throw new ValidationError('valid periodEnd is required')
    if (periodEnd <= periodStart)     throw new ValidationError('periodEnd must be after periodStart')

    const period = await prisma.auditPeriod.create({
      data: {
        orgId:       session.orgId,
        name,
        framework,
        periodStart,
        periodEnd,
        openedBy:    session.userId,
        status:      'OPEN',
      },
    })

    return NextResponse.json({ period }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/audit-periods')
  }
}
