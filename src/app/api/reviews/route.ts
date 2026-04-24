// src/app/api/reviews/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

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
    const body  = await req.json()

    if (!body.entityId)   throw new ValidationError('entityId is required')
    if (!body.reviewType) throw new ValidationError('reviewType is required')
    if (!VALID_TYPES.includes(body.reviewType)) throw new ValidationError('Invalid reviewType')

    const entity = await prisma.entity.findFirst({ where: { id: body.entityId, masterOrgId: orgId } })
    if (!entity) throw new ValidationError('Entity not found')

    const review = await prisma.thirdPartyReview.create({
      data: {
        entityId:       body.entityId,
        orgId,
        reviewType:     body.reviewType,
        status:         body.status && VALID_STATUSES.includes(body.status) ? body.status : 'IN_PROGRESS',
        scheduledAt:    body.scheduledAt    ? new Date(body.scheduledAt)    : null,
        nextReviewDate: body.nextReviewDate ? new Date(body.nextReviewDate) : null,
        triggerEvent:   body.triggerEvent   ? sanitiseString(body.triggerEvent) : null,
        notes:          body.notes          ? sanitiseString(body.notes)        : null,
        reviewedBy:     session.userId,
      },
    })

    return NextResponse.json(review, { status: 201 })
  } catch (err) {
    return handleApiError(err, "")
  }
}
