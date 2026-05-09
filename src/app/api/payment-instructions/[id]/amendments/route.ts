// src/app/api/payment-instructions/[id]/amendments/route.ts
//
// POST — request an amendment to an APPROVED / SENT_TO_ERP / AMENDMENT_PENDING PI
// Body: { changes: Record<string, { from: unknown; to: unknown }>, notes?: string }
//
// PUT — approve or reject a PENDING amendment
// Body: { amendmentId: string, decision: 'APPROVED' | 'REJECTED', rejectionReason?: string }

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import {
  handleApiError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { Prisma } from '@prisma/client'

const RequestAmendmentSchema = z.object({
  changes: z.record(z.object({ from: z.unknown(), to: z.unknown() })),
  notes:   z.string().optional().nullable(),
})

const ReviewAmendmentSchema = z.object({
  amendmentId:     z.string().min(1),
  decision:        z.string().min(1),
  rejectionReason: z.string().optional(),
})

const AMEND_ROLES   = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const APPROVE_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO'])

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!AMEND_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')

    const AMENDABLE = ['APPROVED', 'SENT_TO_ERP', 'AMENDMENT_PENDING']
    if (!AMENDABLE.includes(pi.status)) {
      throw new ValidationError(
        `Amendments can only be requested on APPROVED or SENT_TO_ERP instructions (current: ${pi.status})`,
      )
    }

    const rawBody = await req.json()
    const parsed = RequestAmendmentSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { changes, notes } = parsed.data

    if (Object.keys(changes).length === 0) {
      throw new ValidationError('changes must contain at least one field')
    }

    // Enforce one PENDING amendment per instruction (mirrors the partial unique index)
    const existing = await prisma.paymentInstructionAmendment.findFirst({
      where: { paymentInstructionId: id, status: 'PENDING' },
    })
    if (existing) {
      throw new ConflictError('A pending amendment already exists for this payment instruction')
    }

    const amendment = await prisma.$transaction(async tx => {
      const a = await tx.paymentInstructionAmendment.create({
        data: {
          paymentInstructionId: id,
          changes:              changes as Prisma.InputJsonValue,
          status:               'PENDING',
          requestedBy:          session.userId!,
          notes:                notes ? sanitiseString(notes) : null,
        },
      })

      await tx.paymentInstruction.update({
        where: { id },
        data:  { status: 'AMENDMENT_PENDING' },
      })

      return a
    }, { timeout: 15000 })

    return NextResponse.json({ amendment }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/amendments')
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!APPROVE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')

    const rawBody = await req.json()
    const parsedPut = ReviewAmendmentSchema.safeParse(rawBody)
    if (!parsedPut.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsedPut.error.issues },
        { status: 400 },
      )
    }
    const { amendmentId, decision, rejectionReason } = parsedPut.data
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      throw new ValidationError('decision must be APPROVED or REJECTED')
    }

    const amendment = await prisma.paymentInstructionAmendment.findUnique({ where: { id: amendmentId } })
    if (!amendment || amendment.paymentInstructionId !== id) throw new NotFoundError('Amendment not found')
    if (amendment.status !== 'PENDING') throw new ValidationError('Amendment is no longer pending')

    await prisma.$transaction(async tx => {
      await tx.paymentInstructionAmendment.update({
        where: { id: amendmentId },
        data: {
          status:          decision as never,
          reviewedBy:      session.userId,
          reviewedAt:      new Date(),
          rejectionReason: decision === 'REJECTED' ? sanitiseString(rejectionReason ?? '') : null,
        },
      })

      if (decision === 'APPROVED') {
        // Apply each changed field's `to` value to the payment instruction
        const changes = amendment.changes as Record<string, { from: unknown; to: unknown }>
        const newVersion = pi.currentVersion + 1
        const piUpdates: Record<string, unknown> = { currentVersion: newVersion }

        if ('amount'        in changes) piUpdates.amount        = Number(changes.amount.to)
        if ('entityId'      in changes) piUpdates.entityId      = String(changes.entityId.to)
        if ('bankAccountId' in changes) piUpdates.bankAccountId = String(changes.bankAccountId.to)
        if ('currency'      in changes) piUpdates.currency      = String(changes.currency.to)

        await tx.paymentInstruction.update({ where: { id }, data: piUpdates })

        await tx.paymentInstructionVersion.create({
          data: {
            paymentInstructionId: id,
            version:      newVersion,
            entityId:     'entityId'      in changes ? String(changes.entityId.to)      : pi.entityId,
            bankAccountId:'bankAccountId' in changes ? String(changes.bankAccountId.to) : pi.bankAccountId,
            amount:       'amount'        in changes ? Number(changes.amount.to)         : Number(pi.amount),
            currency:     'currency'      in changes ? String(changes.currency.to)       : pi.currency,
            dueDate:      pi.dueDate,
            glCode:       pi.glCode,
            costCentre:   pi.costCentre,
            snapshotBy:   session.userId!,
            changeReason: `Amendment approved: ${Object.keys(changes).join(', ')} changed`,
          },
        })
      }

      // Restore PI status once no PENDING amendments remain
      const remaining = await tx.paymentInstructionAmendment.count({
        where: { paymentInstructionId: id, status: 'PENDING' },
      })
      if (remaining === 0) {
        await tx.paymentInstruction.update({
          where: { id },
          data:  { status: pi.status === 'AMENDMENT_PENDING' ? 'APPROVED' : pi.status },
        })
      }
    }, { timeout: 15000 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/payment-instructions/[id]/amendments')
  }
}
