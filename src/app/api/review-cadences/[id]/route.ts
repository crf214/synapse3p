// src/app/api/review-cadences/[id]/route.ts — PUT + DELETE

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'

const UpdateReviewCadenceSchema = z.object({
  name:               z.string().optional(),
  riskScoreMin:       z.number().optional(),
  riskScoreMax:       z.number().optional(),
  reviewIntervalDays: z.number().optional(),
  domains:            z.array(z.string()).optional(),
  isActive:           z.boolean().optional(),
})

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

    const rawBody = await req.json()
    const parsed = UpdateReviewCadenceSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

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
        ...(body.domains             !== undefined && { domains:            body.domains as never[] }),
        ...(body.isActive            !== undefined && { isActive:           Boolean(body.isActive) }),
      },
    })

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      session.orgId!,
      action:     'UPDATE',
      objectType: 'REVIEW_CADENCE',
      objectId:   id,
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

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      session.orgId!,
      action:     'DELETE',
      objectType: 'REVIEW_CADENCE',
      objectId:   id,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, "")
  }
}
