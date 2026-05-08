// src/app/api/payment-executions/[id]/retry/route.ts
// POST — retry a FAILED payment execution (max 3 attempts)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { retryExecution } from '@/lib/payments/execution-runner'

const RETRY_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO', 'FINANCE_MANAGER'])

type Params = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!RETRY_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const execution = await prisma.paymentExecution.findUnique({ where: { id: params.id } })
    if (!execution || execution.orgId !== session.orgId) throw new NotFoundError('Payment execution not found')

    try {
      await retryExecution(params.id)
    } catch (execErr) {
      const reason = execErr instanceof Error ? execErr.message : 'Retry failed'
      return NextResponse.json(
        { error: { message: reason, code: 'EXECUTION_FAILED' } },
        { status: 422 },
      )
    }

    const updated = await prisma.paymentExecution.findUnique({ where: { id: params.id } })
    return NextResponse.json({ ok: true, status: updated?.status, reference: updated?.reference })
  } catch (err) {
    return handleApiError(err, `POST /api/payment-executions/${params.id}/retry`)
  }
}
