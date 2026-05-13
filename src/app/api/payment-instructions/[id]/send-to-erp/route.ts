// src/app/api/payment-instructions/[id]/send-to-erp/route.ts
// POST — submit an APPROVED payment instruction to the ERP.
// Creates a PaymentExecution record, then immediately drives it through the
// execution engine (SCHEDULED → PROCESSING → COMPLETED | FAILED).

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { executePaymentExecution } from '@/lib/payments/execution-runner'
import { APPROVAL_ROLES } from '@/lib/security/roles'

const SUBMIT_ROLES = APPROVAL_ROLES

const RAIL_MAP: Record<string, 'ERP' | 'BANK_API' | 'STRIPE'> = {
  ACH:      'BANK_API',
  WIRE:     'BANK_API',
  SEPA:     'BANK_API',
  SWIFT:    'BANK_API',
  CHECK:    'ERP',
  INTERNAL: 'ERP',
  STRIPE:   'STRIPE',
  OTHER:    'ERP',
}

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!SUBMIT_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')
    if (pi.status !== 'APPROVED') {
      throw new ValidationError(
        `Payment instruction must be APPROVED before sending to ERP (current: ${pi.status})`,
      )
    }

    const bankAccount = await prisma.entityBankAccount.findUnique({
      where:  { id: pi.bankAccountId },
      select: { paymentRail: true },
    })

    const rail = RAIL_MAP[bankAccount?.paymentRail ?? ''] ?? 'ERP'

    // Atomically guard against duplicate executions, create the record, and
    // update PI status. Without a transaction, two concurrent requests could
    // both pass the existence check and both create an execution.
    const execution = await prisma.$transaction(async (tx) => {
      const existing = await tx.paymentExecution.findFirst({
        where: { invoiceId: pi.invoiceId, orgId: pi.orgId, status: { not: 'CANCELLED' } },
      })
      if (existing) {
        throw new ValidationError(
          `A payment execution already exists for this invoice (status: ${existing.status})`,
        )
      }

      const created = await tx.paymentExecution.create({
        data: {
          invoiceId:            pi.invoiceId,
          orgId:                pi.orgId,
          entityId:             pi.entityId,
          paymentInstructionId: id,
          bankAccountId:        pi.bankAccountId,
          amount:               pi.amount,
          currency:             pi.currency,
          rail,
          status:               'SCHEDULED',
          scheduledAt:          pi.dueDate ?? new Date(),
          metadata:             {},
        },
      })

      await tx.paymentInstruction.update({
        where: { id },
        data:  { status: 'SENT_TO_ERP', sentToErpAt: new Date() },
      })

      return created
    }, { timeout: 10000 })

    // Drive the execution immediately — adapter is called here.
    // On failure, execution stays FAILED and PI status is set to FAILED by the runner.
    // The HTTP response reflects the outcome.
    try {
      await executePaymentExecution(execution.id)
    } catch (execErr) {
      // Execution failed — return 422 with the failure reason so the UI can surface it.
      const reason = execErr instanceof Error ? execErr.message : 'Payment execution failed'
      return NextResponse.json(
        { error: { message: reason, code: 'EXECUTION_FAILED' }, executionId: execution.id },
        { status: 422 },
      )
    }

    // Fetch updated execution to return current state to the caller
    const updated = await prisma.paymentExecution.findUnique({ where: { id: execution.id } })

    return NextResponse.json({
      ok:          true,
      executionId: execution.id,
      status:      updated?.status,
      reference:   updated?.reference,
    })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/send-to-erp')
  }
}
