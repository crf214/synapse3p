import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { writeAuditEvent } from '@/lib/audit'
import { updateEntityRisk } from '@/lib/risk/update-entity-risk'
import { RiskBand } from '@prisma/client'

const OVERRIDE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])
const VALID_BANDS    = new Set<string>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !OVERRIDE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const body = await req.json() as { band?: unknown; reason?: unknown }
    const band   = typeof body.band   === 'string' ? body.band.toUpperCase()   : ''
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

    if (!VALID_BANDS.has(band)) throw new ValidationError('Invalid band. Must be LOW, MEDIUM, HIGH, or CRITICAL.')
    if (reason.length < 20)    throw new ValidationError('Reason must be at least 20 characters.')

    const existing = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId },
    })
    if (!existing) throw new NotFoundError('Entity not found')

    const entity = await prisma.$transaction(async (tx) => {
      const updated = await tx.entity.update({
        where: { id: entityId },
        data: {
          riskBandOverride:       band as RiskBand,
          riskBandOverrideReason: reason,
          riskBandOverrideBy:     session.userId,
          riskBandOverrideAt:     new Date(),
        },
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'OVERRIDE',
        objectType: 'ENTITY',
        objectId:   entityId,
        after:      { riskBandOverride: band, riskBandOverrideReason: reason },
      })

      await tx.entityActivityLog.create({
        data: {
          entityId,
          orgId:        session.orgId!,
          activityType: 'RISK_SCORE_CHANGE',
          title:        'Manual risk band override applied',
          description:  `Band set to ${band}. Reason: ${reason}`,
          performedBy:  session.name ?? session.email ?? session.userId ?? 'Unknown',
          occurredAt:   new Date(),
        },
      })

      return updated
    })

    // Recompute risk band asynchronously (will respect the new override)
    void updateEntityRisk(entityId, prisma).catch(console.error)

    return NextResponse.json({ entity })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities/[entityId]/risk-override')
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !OVERRIDE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const existing = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId },
    })
    if (!existing) throw new NotFoundError('Entity not found')

    const entity = await prisma.$transaction(async (tx) => {
      const updated = await tx.entity.update({
        where: { id: entityId },
        data: {
          riskBandOverride:       null,
          riskBandOverrideReason: null,
          riskBandOverrideBy:     null,
          riskBandOverrideAt:     null,
        },
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'OVERRIDE',
        objectType: 'ENTITY',
        objectId:   entityId,
        after:      { riskBandOverride: null },
      })

      await tx.entityActivityLog.create({
        data: {
          entityId,
          orgId:        session.orgId!,
          activityType: 'RISK_SCORE_CHANGE',
          title:        'Manual risk band override cleared',
          description:  'Risk band override has been removed; computed band will be applied.',
          performedBy:  session.name ?? session.email ?? session.userId ?? 'Unknown',
          occurredAt:   new Date(),
        },
      })

      return updated
    })

    // Recompute risk band without override
    void updateEntityRisk(entityId, prisma).catch(console.error)

    return NextResponse.json({ entity })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/entities/[entityId]/risk-override')
  }
}
