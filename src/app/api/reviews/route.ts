// src/app/api/reviews/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { updateEntityRisk } from '@/lib/risk/update-entity-risk'
import { writeAuditEvent } from '@/lib/audit'

const CreateReviewSchema = z.object({
  entityId:       z.string().min(1),
  reviewType:     z.string().min(1),
  status:         z.string().optional(),
  scheduledAt:    z.string().optional().nullable(),
  nextReviewDate: z.string().optional().nullable(),
  triggerEvent:   z.string().optional().nullable(),
  notes:          z.string().optional().nullable(),
})

const READ_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

const VALID_TYPES    = ['ONBOARDING','PERIODIC','EVENT_TRIGGERED']
const VALID_STATUSES = ['SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE','CANCELLED']

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const orgId    = session.orgId!
    const status   = searchParams.get('status')   ?? undefined
    const type     = searchParams.get('type')     ?? undefined
    const entityId = searchParams.get('entityId') ?? undefined
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const limit    = 50

    const where: Record<string, unknown> = { orgId }
    if (status)   where.status     = status
    if (type)     where.reviewType = type
    if (entityId) where.entityId   = entityId

    const [total, rows] = await Promise.all([
      prisma.thirdPartyReview.count({ where }),
      prisma.thirdPartyReview.findMany({
        where,
        skip:     (page - 1) * limit,
        take:     limit,
        orderBy:  { createdAt: 'desc' },
        include:  {
          entity: { select: { id: true, name: true } },
        },
      }),
    ])

    const reviews = rows.map(r => ({
      ...r,
      scheduledAt:    r.scheduledAt?.toISOString()  ?? null,
      completedAt:    r.completedAt?.toISOString()  ?? null,
      nextReviewDate: r.nextReviewDate?.toISOString()  ?? null,
      createdAt:      r.createdAt.toISOString(),
      updatedAt:      r.updatedAt.toISOString(),
    }))

    return NextResponse.json({ reviews, total, page, limit })
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const orgId = session.orgId!
    const rawBody = await req.json()
    const parsed = CreateReviewSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    if (!VALID_TYPES.includes(body.reviewType)) throw new ValidationError('Invalid reviewType')

    const entity = await prisma.entity.findFirst({ where: { id: body.entityId, masterOrgId: orgId } })
    if (!entity) throw new ValidationError('Entity not found')

    const review = await prisma.thirdPartyReview.create({
      data: {
        entityId:       body.entityId,
        orgId,
        reviewType:     body.reviewType as never,
        status:         body.status && VALID_STATUSES.includes(body.status) ? body.status as never : 'IN_PROGRESS',
        scheduledAt:    body.scheduledAt    ? new Date(body.scheduledAt)    : null,
        nextReviewDate: body.nextReviewDate ? new Date(body.nextReviewDate) : null,
        triggerEvent:   body.triggerEvent   ? sanitiseString(body.triggerEvent) : null,
        notes:          body.notes          ? sanitiseString(body.notes)        : null,
        reviewedBy:     session.userId,
      },
    })

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId,
      action:     'CREATE',
      objectType: 'REVIEW',
      objectId:   review.id,
    })

    // Recompute risk band asynchronously after review creation
    void updateEntityRisk(review.entityId, prisma).catch(console.error)

    return NextResponse.json(review, { status: 201 })
  } catch (err) {
    return handleApiError(err, "")
  }
}
