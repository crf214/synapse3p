// src/app/api/reviews/[id]/route.ts — GET (detail) + PUT (update findings/scores)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const READ_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const review = await prisma.thirdPartyReview.findUnique({
      where: { id: params.id },
      include: {
        entity: {
          select: {
            id:   true,
            name: true,
            riskScores: { orderBy: { scoredAt: 'desc' }, take: 1, select: { computedScore: true } },
          },
        },
      },
    })
    if (!review || review.orgId !== session.orgId) throw new NotFoundError('Review not found')

    // Fetch reviewer / approver names
    const userIds = [review.reviewedBy, review.approvedBy].filter(Boolean) as string[]
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    return NextResponse.json({
      ...review,
      scheduledAt:    review.scheduledAt?.toISOString()    ?? null,
      completedAt:    review.completedAt?.toISOString()    ?? null,
      nextReviewDate: review.nextReviewDate?.toISOString() ?? null,
      createdAt:      review.createdAt.toISOString(),
      updatedAt:      review.updatedAt.toISOString(),
      reviewer:  review.reviewedBy ? userMap[review.reviewedBy] ?? null : null,
      approver:  review.approvedBy ? userMap[review.approvedBy] ?? null : null,
    })
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const review = await prisma.thirdPartyReview.findUnique({ where: { id: params.id } })
    if (!review || review.orgId !== session.orgId) throw new NotFoundError('Review not found')

    const body = await req.json()

    const VALID_STATUSES = ['SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE','CANCELLED']
    if (body.status && !VALID_STATUSES.includes(body.status)) throw new ValidationError('Invalid status')

    const data: Record<string, unknown> = {}

    if (body.status !== undefined)         data.status         = body.status
    if (body.cyberScore !== undefined)     data.cyberScore     = body.cyberScore !== '' ? Number(body.cyberScore) : null
    if (body.legalScore !== undefined)     data.legalScore     = body.legalScore !== '' ? Number(body.legalScore) : null
    if (body.privacyScore !== undefined)   data.privacyScore   = body.privacyScore !== '' ? Number(body.privacyScore) : null
    if (body.overallScore !== undefined)   data.overallScore   = body.overallScore !== '' ? Number(body.overallScore) : null
    if (body.cyberFindings !== undefined)  data.cyberFindings  = body.cyberFindings
    if (body.legalFindings !== undefined)  data.legalFindings  = body.legalFindings
    if (body.privacyFindings !== undefined)data.privacyFindings= body.privacyFindings
    if (body.notes !== undefined)          data.notes          = body.notes ? sanitiseString(body.notes) : null
    if (body.nextReviewDate !== undefined) data.nextReviewDate = body.nextReviewDate ? new Date(body.nextReviewDate) : null
    if (body.scheduledAt !== undefined)    data.scheduledAt    = body.scheduledAt    ? new Date(body.scheduledAt)    : null

    // Mark completedAt when transitioning to COMPLETED
    if (body.status === 'COMPLETED' && review.status !== 'COMPLETED') {
      data.completedAt = new Date()
      data.approvedBy  = session.userId
    }

    const updated = await prisma.thirdPartyReview.update({ where: { id: params.id }, data })

    return NextResponse.json({
      ...updated,
      scheduledAt:    updated.scheduledAt?.toISOString()    ?? null,
      completedAt:    updated.completedAt?.toISOString()    ?? null,
      nextReviewDate: updated.nextReviewDate?.toISOString() ?? null,
      createdAt:      updated.createdAt.toISOString(),
      updatedAt:      updated.updatedAt.toISOString(),
    })
  } catch (err) {
    return handleApiError(err, "")
  }
}
