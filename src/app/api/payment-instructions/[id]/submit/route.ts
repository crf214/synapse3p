// src/app/api/payment-instructions/[id]/submit/route.ts
// POST — submit a DRAFT payment instruction for approval

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

type Params = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()

    const allowed = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])
    if (!allowed.has(session.role ?? '')) throw new ForbiddenError()

    const pi = await prisma.paymentInstruction.findUnique({ where: { id: params.id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')
    if (pi.status !== 'DRAFT') throw new ValidationError(`Only DRAFT instructions can be submitted (current: ${pi.status})`)
    if (pi.createdBy !== session.userId && !['ADMIN'].includes(session.role ?? '')) {
      throw new ForbiddenError('Only the creator or an admin can submit this payment instruction')
    }

    await prisma.paymentInstruction.update({
      where: { id: params.id },
      data:  { status: 'PENDING_APPROVAL' },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/submit')
  }
}
