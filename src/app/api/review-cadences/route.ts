// src/app/api/review-cadences/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const MANAGE_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER'])

const VALID_DOMAINS = ['CYBERSECURITY','LEGAL','PRIVACY','FINANCIAL','OPERATIONAL']

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!MANAGE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const cadences = await prisma.reviewCadence.findMany({
      where: { orgId: session.orgId! },
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
    if (!MANAGE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const body = await req.json()

    if (!body.name) throw new ValidationError('name is required')
    if (body.reviewIntervalDays === undefined) throw new ValidationError('reviewIntervalDays is required')
    if (!Array.isArray(body.domains) || body.domains.length === 0) throw new ValidationError('at least one domain is required')
    if (!body.domains.every((d: unknown) => VALID_DOMAINS.includes(d as string))) throw new ValidationError('Invalid domain')

    const cadence = await prisma.reviewCadence.create({
      data: {
        orgId:               session.orgId!,
        name:                sanitiseString(body.name),
        riskScoreMin:        body.riskScoreMin !== undefined ? Number(body.riskScoreMin) : 0,
        riskScoreMax:        body.riskScoreMax !== undefined ? Number(body.riskScoreMax) : 10,
        reviewIntervalDays:  Number(body.reviewIntervalDays),
        domains:             body.domains,
        isActive:            body.isActive ?? true,
        createdBy:           session.userId,
      },
    })

    return NextResponse.json(cadence, { status: 201 })
  } catch (err) {
    return handleApiError(err, "")
  }
}
