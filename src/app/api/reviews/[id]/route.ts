// src/app/api/reviews/[id]/route.ts — GET (detail) + PUT (update findings/scores)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { updateEntityRisk } from '@/lib/risk/update-entity-risk'
import { writeAuditEvent } from '@/lib/audit'

const UpdateReviewSchema = z.object({
  status:          z.string().optional(),
  cyberScore:      z.number().nullable().optional(),
  legalScore:      z.number().nullable().optional(),
  privacyScore:    z.number().nullable().optional(),
  overallScore:    z.number().nullable().optional(),
  cyberFindings:   z.unknown().optional(),
  legalFindings:   z.unknown().optional(),
  privacyFindings: z.unknown().optional(),
  notes:           z.string().nullable().optional(),
  nextReviewDate:  z.string().nullable().optional(),
  scheduledAt:     z.string().nullable().optional(),
})

const READ_ROLES  = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])
const VALID_STATUSES = new Set(['SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE','CANCELLED'])

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params

    const review = await prisma.thirdPartyReview.findUnique({
      where: { id },
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
    return handleApiError(err, 'GET /api/reviews/[id]')
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params

    const review = await prisma.thirdPartyReview.findUnique({ where: { id } })
    if (!review || review.orgId !== session.orgId) throw new NotFoundError('Review not found')

    const rawBody = await req.json()
    const parsed = UpdateReviewSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    if (body.status && !VALID_STATUSES.has(body.status)) throw new ValidationError('Invalid status')

    const data: Record<string, unknown> = {}
    const changedParts: string[] = []

    if (body.status !== undefined && body.status !== review.status) {
      data.status = body.status
      changedParts.push(`status → ${String(body.status).replace(/_/g,' ')}`)
    }
    if (body.cyberScore !== undefined) {
      data.cyberScore = body.cyberScore !== null ? Number(body.cyberScore) : null
    }
    if (body.legalScore !== undefined) {
      data.legalScore = body.legalScore !== null ? Number(body.legalScore) : null
    }
    if (body.privacyScore !== undefined) {
      data.privacyScore = body.privacyScore !== null ? Number(body.privacyScore) : null
    }
    if (body.overallScore !== undefined) {
      data.overallScore = body.overallScore !== null ? Number(body.overallScore) : null
    }
    if (body.cyberFindings !== undefined)   data.cyberFindings   = body.cyberFindings
    if (body.legalFindings !== undefined)   data.legalFindings   = body.legalFindings
    if (body.privacyFindings !== undefined) data.privacyFindings = body.privacyFindings
    if (body.notes !== undefined)           data.notes           = body.notes ? sanitiseString(body.notes) : null
    if (body.nextReviewDate !== undefined)  data.nextReviewDate  = body.nextReviewDate ? new Date(body.nextReviewDate) : null
    if (body.scheduledAt !== undefined)     data.scheduledAt     = body.scheduledAt    ? new Date(body.scheduledAt)    : null

    // Mark completedAt / approvedBy when transitioning to COMPLETED
    if (body.status === 'COMPLETED' && review.status !== 'COMPLETED') {
      data.completedAt = new Date()
      data.approvedBy  = session.userId
    }

    // Build score summary for activity log
    const bodyRec = body as Record<string, unknown>
    const scores = ['overall','cyber','legal','privacy']
      .filter(d => bodyRec[`${d}Score`] !== undefined && bodyRec[`${d}Score`] !== null)
      .map(d => `${d[0].toUpperCase() + d.slice(1)} ${Number(bodyRec[`${d}Score`]).toFixed(1)}`)
    if (scores.length > 0) changedParts.push(`scores: ${scores.join(', ')}`)

    const findingDomains = ['cyber','legal','privacy']
      .filter(d => bodyRec[`${d}Findings`] !== undefined && Object.keys((bodyRec[`${d}Findings`] as Record<string, unknown>) ?? {}).length > 0)
      .map(d => d)
    if (findingDomains.length > 0) changedParts.push(`findings updated: ${findingDomains.join(', ')}`)

    if (body.notes !== undefined) changedParts.push('notes')
    if (body.nextReviewDate !== undefined) changedParts.push('next review date')
    if (body.scheduledAt !== undefined) changedParts.push('scheduled date')

    const updated = await prisma.thirdPartyReview.update({ where: { id }, data })

    // Write activity log
    await prisma.entityActivityLog.create({
      data: {
        entityId:      review.entityId,
        orgId:         session.orgId,
        activityType:  'REVIEW',
        title:         `Review updated`,
        description:   changedParts.length > 0 ? changedParts.join('; ') : 'Review details updated',
        referenceId:   id,
        referenceType: 'ThirdPartyReview',
        performedBy:   session.name ?? session.email ?? session.userId,
        occurredAt:    new Date(),
      },
    })

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      session.orgId,
      action:     'UPDATE',
      objectType: 'REVIEW',
      objectId:   id,
    })

    // Recompute risk band asynchronously after review update
    void updateEntityRisk(review.entityId, prisma).catch(console.error)

    return NextResponse.json({
      ...updated,
      scheduledAt:    updated.scheduledAt?.toISOString()    ?? null,
      completedAt:    updated.completedAt?.toISOString()    ?? null,
      nextReviewDate: updated.nextReviewDate?.toISOString() ?? null,
      createdAt:      updated.createdAt.toISOString(),
      updatedAt:      updated.updatedAt.toISOString(),
    })
  } catch (err) {
    return handleApiError(err, 'PUT /api/reviews/[id]')
  }
}
