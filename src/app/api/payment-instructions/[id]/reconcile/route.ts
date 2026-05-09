// src/app/api/payment-instructions/[id]/reconcile/route.ts
// POST — mark a CONFIRMED payment instruction as RECONCILED.
// Reconciliation is the finance team's final confirmation that the payment
// has cleared and been matched against the books.
// Body: { notes?: string }

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'

const ReconcileSchema = z.object({
  notes: z.string().optional(),
})

const RECONCILE_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO', 'FINANCE_MANAGER'])

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!RECONCILE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')

    // Allow reconciling from CONFIRMED or APPROVED (direct reconciliation without ERP)
    const RECONCILABLE = ['CONFIRMED', 'APPROVED']
    if (!RECONCILABLE.includes(pi.status)) {
      throw new ValidationError(
        `Payment instruction must be CONFIRMED or APPROVED to reconcile (current: ${pi.status})`,
      )
    }

    const rawBody = await req.json().catch(() => ({}))
    const parsed = ReconcileSchema.safeParse(rawBody)
    const notes = parsed.success && parsed.data.notes
      ? sanitiseString(parsed.data.notes)
      : null

    await prisma.$transaction(async tx => {
      await tx.paymentInstruction.update({
        where: { id },
        data: {
          status: 'RECONCILED',
          ...(notes ? { notes: pi.notes ? `${pi.notes}\n${notes}` : notes } : {}),
        },
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'RECONCILE',
        objectType: 'PAYMENT',
        objectId:   id,
      })
    })

    return NextResponse.json({ ok: true, status: 'RECONCILED' })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/reconcile')
  }
}
