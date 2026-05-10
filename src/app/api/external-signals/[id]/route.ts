// src/app/api/external-signals/[id]/route.ts
// PUT — review or dismiss a signal; triggers risk recomputation for confirmed HIGH/CRITICAL signals

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { updateEntityRisk } from '@/lib/risk/update-entity-risk'

const UpdateExternalSignalSchema = z.object({
  dismissed: z.boolean().optional(),
})

const ALLOWED_ROLES = new Set(['ADMIN', 'CISO', 'CONTROLLER', 'CFO'])

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const signal = await prisma.externalSignal.findUnique({ where: { id } })
    if (!signal || signal.orgId !== session.orgId) throw new NotFoundError('Signal not found')

    const rawBody = await req.json()
    const parsed = UpdateExternalSignalSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data
    const data: Record<string, unknown> = {}

    if (body.dismissed !== undefined) {
      data.dismissed  = Boolean(body.dismissed)
      data.reviewedBy = session.userId
      data.reviewedAt = new Date()
    }

    const updated = await prisma.externalSignal.update({ where: { id }, data })

    // ── 2.18 Signal → risk score impact ────────────────────────────────────
    // A signal is treated as "confirmed" when:
    //   - it has been reviewed (reviewedBy is set, which happens on every PUT)
    //   - dismissed === false  (the reviewer confirmed the signal, not dismissed it)
    //   - severity is HIGH or CRITICAL
    //   - the signal is linked to an entity
    const isConfirmed =
      !updated.dismissed &&
      (updated.severity === 'HIGH' || updated.severity === 'CRITICAL') &&
      updated.entityId != null

    if (isConfirmed && updated.entityId) {
      const entityId = updated.entityId

      // Recompute risk band
      void updateEntityRisk(entityId, prisma).catch(console.error)

      // Mark the signal as having affected the risk score
      void prisma.externalSignal.update({
        where: { id },
        data:  { affectedRiskScore: true },
      }).catch(console.error)

      // Write activity log entry (matches pattern used across all API routes)
      void prisma.entityActivityLog.create({
        data: {
          entityId,
          orgId:         signal.orgId,
          activityType:  'RISK_SCORE_CHANGE',
          title:         'Risk score recomputed due to external signal',
          description:   `Risk score recomputed due to external signal: ${updated.title}`,
          referenceId:   id,
          referenceType: 'ExternalSignal',
          performedBy:   session.name ?? session.email ?? session.userId,
          occurredAt:    new Date(),
          metadata:      {
            signalId:   id,
            signalTitle: updated.title,
            severity:   updated.severity,
            action:     'RISK_RECOMPUTED_FROM_SIGNAL',
          },
        },
      }).catch(console.error)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/external-signals/[id]')
  }
}
