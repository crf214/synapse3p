// src/app/api/review-cadences/[id]/route.ts — PUT + DELETE

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const MANAGE_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER'])
const VALID_DOMAINS = ['CYBERSECURITY','LEGAL','PRIVACY','FINANCIAL','OPERATIONAL']

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!MANAGE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const cadence = await prisma.reviewCadence.findUnique({ where: { id } })
    if (!cadence || cadence.orgId !== session.orgId) throw new NotFoundError("Not found")

    const body = await req.json()
    if (body.domains && !body.domains.every((d: unknown) => VALID_DOMAINS.includes(d as string))) {
      throw new ValidationError('Invalid domain')
    }

    const updated = await prisma.reviewCadence.update({
      where: { id },
      data: {
        ...(body.name                !== undefined && { name:               sanitiseString(body.name) }),
        ...(body.riskScoreMin        !== undefined && { riskScoreMin:       Number(body.riskScoreMin) }),
        ...(body.riskScoreMax        !== undefined && { riskScoreMax:       Number(body.riskScoreMax) }),
        ...(body.reviewIntervalDays  !== undefined && { reviewIntervalDays: Number(body.reviewIntervalDays) }),
        ...(body.domains             !== undefined && { domains:            body.domains }),
        ...(body.isActive            !== undefined && { isActive:           Boolean(body.isActive) }),
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!MANAGE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const cadence = await prisma.reviewCadence.findUnique({ where: { id } })
    if (!cadence || cadence.orgId !== session.orgId) throw new NotFoundError("Not found")

    await prisma.reviewCadence.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, "")
  }
}
