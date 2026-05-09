// src/app/api/payment-instructions/[id]/cancel/route.ts
// POST — cancel a payment instruction (any non-terminal status)
// Body: { reason: string }

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'

const CancelPaymentInstructionSchema = z.object({
  reason: z.string().min(1),
})

const CANCEL_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO', 'FINANCE_MANAGER'])

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!CANCEL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')

    // APPROVED and beyond cannot be cancelled — payment has been formally authorised
    const NON_CANCELLABLE = ['APPROVED', 'SENT_TO_ERP', 'CONFIRMED', 'RECONCILED', 'CANCELLED', 'FAILED']
    if (NON_CANCELLABLE.includes(pi.status)) {
      throw new ValidationError(`Cannot cancel a ${pi.status} payment instruction`)
    }

    const rawBody = await req.json()
    const parsed = CancelPaymentInstructionSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const reason = sanitiseString(parsed.data.reason ?? '')
    if (!reason) throw new ValidationError('Cancellation reason is required')

    await prisma.$transaction(async (tx) => {
      await tx.paymentInstruction.update({
        where: { id },
        data: {
          status:             'CANCELLED',
          cancelledAt:        new Date(),
          cancellationReason: reason,
        },
      })
      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'CANCEL',
        objectType: 'PAYMENT',
        objectId:   id,
      })
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/cancel')
  }
}
