// src/app/api/review-cadences/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'

const CreateReviewCadenceSchema = z.object({
  name:               z.string().min(1),
  reviewIntervalDays: z.number(),
  domains:            z.array(z.string()).min(1),
  riskScoreMin:       z.number().optional(),
  riskScoreMax:       z.number().optional(),
  isActive:           z.boolean().optional(),
})

const MANAGE_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER'])

const VALID_DOMAINS = ['CYBERSECURITY','LEGAL','PRIVACY','FINANCIAL','OPERATIONAL']

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    const orgId = session.orgId
    if (!MANAGE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const cadences = await prisma.reviewCadence.findMany({
      where: { orgId: orgId },
      orderBy: { riskScoreMin: 'asc' },
    })

    return NextResponse.json({ cadences })
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    const orgId = session.orgId
    if (!MANAGE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreateReviewCadenceSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    if (!body.domains.every((d: unknown) => VALID_DOMAINS.includes(d as string))) throw new ValidationError('Invalid domain')

    const cadence = await prisma.reviewCadence.create({
      data: {
        orgId:               orgId,
        name:                sanitiseString(body.name),
        riskScoreMin:        body.riskScoreMin !== undefined ? Number(body.riskScoreMin) : 0,
        riskScoreMax:        body.riskScoreMax !== undefined ? Number(body.riskScoreMax) : 10,
        reviewIntervalDays:  Number(body.reviewIntervalDays),
        domains:             body.domains as never[],
        isActive:            body.isActive ?? true,
        createdBy:           session.userId,
      },
    })

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      orgId,
      action:     'CREATE',
      objectType: 'REVIEW_CADENCE',
      objectId:   cadence.id,
    })

    return NextResponse.json(cadence, { status: 201 })
  } catch (err) {
    return handleApiError(err, "")
  }
}
