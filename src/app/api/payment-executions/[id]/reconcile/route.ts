// src/app/api/payment-executions/[id]/reconcile/route.ts
// POST — manually mark a COMPLETED execution as reconciled + GL-posted,
//        and transition the linked invoice to PAID.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { reconcileExecution } from '@/lib/payments/execution-runner'

const RECONCILE_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO', 'FINANCE_MANAGER'])

type Params = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!RECONCILE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const execution = await prisma.paymentExecution.findUnique({ where: { id: params.id } })
    if (!execution || execution.orgId !== session.orgId) throw new NotFoundError('Payment execution not found')

    await reconcileExecution(params.id, session.userId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, `POST /api/payment-executions/${params.id}/reconcile`)
  }
}
