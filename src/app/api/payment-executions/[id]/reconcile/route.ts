// src/app/api/payment-executions/[id]/reconcile/route.ts
// POST — manually mark a COMPLETED execution as reconciled + GL-posted,
//        and transition the linked invoice to PAID.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { reconcileExecution } from '@/lib/payments/execution-runner'
import { APPROVAL_ROLES } from '@/lib/security/roles'

const RECONCILE_ROLES = APPROVAL_ROLES

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!RECONCILE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const execution = await prisma.paymentExecution.findUnique({ where: { id } })
    if (!execution || execution.orgId !== session.orgId) throw new NotFoundError('Payment execution not found')

    await reconcileExecution(id, session.userId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-executions/[id]/reconcile')
  }
}
