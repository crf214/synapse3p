// src/app/api/entities/[entityId]/due-diligence/route.ts
//
// GET  — return current EntityDueDiligence record
// PATCH — update kycStatus and/or kybStatus with transition validation
//
// Allowed transitions (matches KycStatus / KybStatus enums in schema.prisma):
//   NOT_REQUIRED → PENDING
//   PENDING      → IN_REVIEW
//   IN_REVIEW    → APPROVED | FAILED
//   APPROVED     → EXPIRED
//   FAILED       → IN_REVIEW   (re-submission)
//
// When status moves to APPROVED the reviewedAt timestamp is set automatically.
// NOTE: an explicit `expiresAt` field does not exist on EntityDueDiligence —
// `nextReviewDate` serves as the nearest proxy. If a hard expiry date is required
// a migration should add `expiresAt DateTime?` to the model.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Transition table — only these moves are valid
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NOT_REQUIRED: ['PENDING'],
  PENDING:      ['IN_REVIEW'],
  IN_REVIEW:    ['APPROVED', 'FAILED'],
  APPROVED:     ['EXPIRED'],
  FAILED:       ['IN_REVIEW'],
  EXPIRED:      [],
}

const STATUS_VALUES = ['NOT_REQUIRED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'FAILED', 'EXPIRED'] as const

const PatchDueDiligenceSchema = z.object({
  kycStatus:     z.enum(STATUS_VALUES).optional(),
  kybStatus:     z.enum(STATUS_VALUES).optional(),
  reviewedBy:    z.string().optional(),
  nextReviewDate: z.string().optional().nullable(),
  ddLevel:       z.number().int().min(1).max(3).optional(),
  notes:         z.string().optional(),
})

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR', 'LEGAL', 'CISO'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'LEGAL', 'CISO'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertTransition(field: string, from: string, to: string): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    throw new ValidationError(`Invalid status transition from ${from} to ${to}`)
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const dueDiligence = await prisma.entityDueDiligence.findUnique({
      where: { entityId },
    })

    return NextResponse.json({ dueDiligence: dueDiligence ?? null })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/due-diligence')
  }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const rawBody = await req.json()
    const parsed = PatchDueDiligenceSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    // Load existing record (create with defaults if not yet present)
    const existing = await prisma.entityDueDiligence.upsert({
      where:  { entityId },
      create: { entityId },
      update: {},
    })

    // ── Validate transitions ──────────────────────────────────────────────────
    if (body.kycStatus !== undefined) {
      assertTransition('kycStatus', existing.kycStatus, body.kycStatus)
    }
    if (body.kybStatus !== undefined) {
      assertTransition('kybStatus', existing.kybStatus, body.kybStatus)
    }

    // ── Build update payload ──────────────────────────────────────────────────
    const approvedNow =
      body.kycStatus === 'APPROVED' || body.kybStatus === 'APPROVED'
    const nextReviewDate = body.nextReviewDate
      ? new Date(body.nextReviewDate)
      : undefined

    const updates: Record<string, unknown> = {
      ...(body.kycStatus     !== undefined ? { kycStatus: body.kycStatus }         : {}),
      ...(body.kybStatus     !== undefined ? { kybStatus: body.kybStatus }         : {}),
      ...(body.ddLevel       !== undefined ? { ddLevel: body.ddLevel }             : {}),
      ...(nextReviewDate     !== undefined ? { nextReviewDate }                    : {}),
      // reviewedAt and reviewedBy are set when a status reaches APPROVED
      ...(approvedNow ? {
        reviewedAt: new Date(),
        reviewedBy: body.reviewedBy ?? session.userId,
      } : {}),
    }

    const dueDiligence = await prisma.$transaction(async (tx) => {
      const updated = await tx.entityDueDiligence.update({
        where: { entityId },
        data:  updates,
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'UPDATE',
        objectType: 'ENTITY',
        objectId:   entityId,
        before:     {
          kycStatus: existing.kycStatus,
          kybStatus: existing.kybStatus,
        },
        after: {
          kycStatus: updated.kycStatus,
          kybStatus: updated.kybStatus,
        },
      })

      return updated
    })

    // Activity log entry
    const changedParts: string[] = []
    if (body.kycStatus) changedParts.push(`KYC: ${existing.kycStatus} → ${body.kycStatus}`)
    if (body.kybStatus) changedParts.push(`KYB: ${existing.kybStatus} → ${body.kybStatus}`)

    await prisma.entityActivityLog.create({
      data: {
        entityId,
        orgId:        session.orgId,
        activityType: 'STATUS_CHANGE',
        title:        'Due diligence status updated',
        description:  changedParts.join('; '),
        performedBy:  session.name ?? session.email ?? session.userId,
        occurredAt:   new Date(),
      },
    })

    return NextResponse.json({ dueDiligence })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/entities/[entityId]/due-diligence')
  }
}
