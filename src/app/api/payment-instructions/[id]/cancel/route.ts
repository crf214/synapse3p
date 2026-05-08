// src/app/api/payment-instructions/[id]/cancel/route.ts
// POST — cancel a payment instruction (any non-terminal status)
// Body: { reason: string }

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

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

    const TERMINAL = ['CONFIRMED', 'CANCELLED', 'FAILED']
    if (TERMINAL.includes(pi.status)) {
      throw new ValidationError(`Cannot cancel a ${pi.status} payment instruction`)
    }

    const body = await req.json()
    const reason = sanitiseString(body.reason ?? '')
    if (!reason) throw new ValidationError('Cancellation reason is required')

    await prisma.paymentInstruction.update({
      where: { id },
      data: {
        status:             'CANCELLED',
        cancelledAt:        new Date(),
        cancellationReason: reason,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/cancel')
  }
}
