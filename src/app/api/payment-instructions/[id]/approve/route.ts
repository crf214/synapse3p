// src/app/api/payment-instructions/[id]/approve/route.ts
// POST — approve or reject a PENDING_APPROVAL payment instruction
// Body: { decision: 'APPROVED' | 'REJECTED', notes?: string }

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

const APPROVER_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO'])

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!APPROVER_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')
    if (pi.status !== 'PENDING_APPROVAL') {
      throw new ValidationError(`Cannot approve/reject — current status is ${pi.status}`)
    }

    // Four-eyes: approver must not be the creator
    if (pi.createdBy === session.userId) {
      throw new ForbiddenError('Four-eyes control: the creator cannot approve their own payment instruction')
    }

    const body = await req.json()
    const { decision, notes } = body as { decision: 'APPROVED' | 'REJECTED'; notes?: string }
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new ValidationError('decision must be APPROVED or REJECTED')

    const newStatus = decision === 'APPROVED' ? 'APPROVED' : 'DRAFT'

    await prisma.paymentInstruction.update({
      where: { id },
      data: {
        status:     newStatus,
        approvedBy: decision === 'APPROVED' ? session.userId : null,
        approvedAt: decision === 'APPROVED' ? new Date()     : null,
        notes:      notes ? `${pi.notes ? pi.notes + '\n' : ''}Approval note: ${notes}` : pi.notes,
      },
    })

    return NextResponse.json({ ok: true, status: newStatus })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/approve')
  }
}
