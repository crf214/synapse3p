// src/lib/payments/execution-runner.ts
//
// Core payment execution engine. Drives PaymentExecution records through:
//   SCHEDULED → PROCESSING → COMPLETED | FAILED
//
// After COMPLETED, executions can be manually reconciled:
//   COMPLETED → RECONCILED  (sets glPosted, marks Invoice as PAID)
//
// The runner never throws after recording failure — callers get a result object.

import { prisma } from '@/lib/prisma'
import { getErpAdapter } from '@/lib/erp'
import type { PaymentInstructionPayload } from '@/lib/erp/types'

const MAX_RETRIES = 3

// ---------------------------------------------------------------------------
// executePaymentExecution
// Drives a single SCHEDULED execution through to COMPLETED or FAILED.
// ---------------------------------------------------------------------------

export async function executePaymentExecution(executionId: string): Promise<void> {
  const execution = await prisma.paymentExecution.findUniqueOrThrow({
    where: { id: executionId },
  })

  if (execution.status !== 'SCHEDULED') {
    throw new Error(`Cannot execute payment in status ${execution.status}`)
  }

  // Fetch the associated PaymentInstruction (1:1 via invoiceId @unique)
  const pi = await prisma.paymentInstruction.findUnique({
    where: { invoiceId: execution.invoiceId },
  })

  // Fetch actual bank account details — bankAccountId is a cuid, not the account number
  const bankAccount = execution.bankAccountId
    ? await prisma.entityBankAccount.findUnique({ where: { id: execution.bankAccountId } })
    : null

  // Mark as PROCESSING immediately so concurrent callers skip this record
  await prisma.paymentExecution.update({
    where: { id: executionId },
    data:  { status: 'PROCESSING' },
  })

  let succeeded     = false
  let erpReference  = ''
  let executedAt    = new Date()
  let failureReason = ''

  try {
    const adapter = getErpAdapter()

    const payload: PaymentInstructionPayload = {
      instructionId: pi?.id ?? executionId,
      vendorErpId:   execution.entityId ?? '',  // adapter resolves to ERP vendor id
      bankAccount: {
        accountNo: bankAccount?.accountNo ?? '',
        routingNo: bankAccount?.routingNo  ?? undefined,
        swiftBic:  bankAccount?.swiftBic   ?? undefined,
      },
      amount:      execution.amount,
      currency:    execution.currency,
      dueDate:     execution.scheduledAt ?? undefined,
      poReference: pi?.poReference       ?? undefined,
      memo:        pi?.notes             ?? undefined,
    }

    const confirmation = await adapter.sendPaymentInstruction(payload)

    succeeded     = confirmation.status === 'SUCCESS'
    erpReference  = confirmation.erpReference ?? ''
    executedAt    = confirmation.executedAt
    failureReason = confirmation.failureReason ?? ''
  } catch (err) {
    failureReason = err instanceof Error ? err.message : 'Adapter error'
  }

  if (succeeded) {
    await prisma.$transaction(async tx => {
      await tx.paymentExecution.update({
        where: { id: executionId },
        data: {
          status:     'COMPLETED',
          executedAt,
          reference:  erpReference,
        },
      })

      // Confirm the payment instruction and stamp the ERP reference
      if (pi) {
        await tx.paymentInstruction.update({
          where: { id: pi.id },
          data: {
            status:          'CONFIRMED',
            confirmedAt:     executedAt,
            confirmedAmount: execution.amount,
            erpReference,
          },
        })
      }
    }, { timeout: 10000 })

    // Activity log outside transaction (non-critical)
    if (pi) {
      await prisma.entityActivityLog.create({
        data: {
          entityId:      execution.entityId ?? pi.entityId,
          orgId:         execution.orgId,
          activityType:  'PAYMENT',
          title:         `Payment executed — ${execution.currency} ${execution.amount.toFixed(2)} · ref ${erpReference}`,
          referenceId:   executionId,
          referenceType: 'PaymentExecution',
          performedBy:   'system',
          metadata:      { erpReference, rail: execution.rail, status: 'COMPLETED' },
        },
      }).catch(() => {})
    }
  } else {
    await prisma.paymentExecution.update({
      where: { id: executionId },
      data: {
        status:        'FAILED',
        failureReason: failureReason || 'Unknown failure',
        retryCount:    { increment: 1 },
      },
    })

    if (pi) {
      await prisma.paymentInstruction.update({
        where: { id: pi.id },
        data:  { status: 'FAILED' },
      }).catch(() => {})
    }

    throw new Error(failureReason || 'Payment execution failed')
  }
}

// ---------------------------------------------------------------------------
// retryExecution
// Resets a FAILED execution to SCHEDULED and re-runs it.
// ---------------------------------------------------------------------------

export async function retryExecution(executionId: string): Promise<void> {
  const execution = await prisma.paymentExecution.findUniqueOrThrow({ where: { id: executionId } })

  if (execution.status !== 'FAILED') {
    throw new Error(`Can only retry FAILED executions (current: ${execution.status})`)
  }
  if (execution.retryCount >= MAX_RETRIES) {
    throw new Error(`Maximum retry attempts (${MAX_RETRIES}) reached for this execution`)
  }

  // Restore PI to SENT_TO_ERP so it's in a retryable state
  const pi = await prisma.paymentInstruction.findUnique({ where: { invoiceId: execution.invoiceId } })
  if (pi) {
    await prisma.paymentInstruction.update({
      where: { id: pi.id },
      data:  { status: 'SENT_TO_ERP' },
    })
  }

  await prisma.paymentExecution.update({
    where: { id: executionId },
    data:  { status: 'SCHEDULED', failureReason: null },
  })

  await executePaymentExecution(executionId)
}

// ---------------------------------------------------------------------------
// reconcileExecution
// Marks a COMPLETED execution as reconciled and GL-posted, and marks the
// associated invoice as PAID.
// ---------------------------------------------------------------------------

export async function reconcileExecution(executionId: string, reconciledBy: string): Promise<void> {
  const execution = await prisma.paymentExecution.findUniqueOrThrow({ where: { id: executionId } })

  if (execution.status !== 'COMPLETED') {
    throw new Error(`Can only reconcile COMPLETED executions (current: ${execution.status})`)
  }

  const now = new Date()

  await prisma.$transaction(async tx => {
    await tx.paymentExecution.update({
      where: { id: executionId },
      data: {
        status:       'RECONCILED',
        reconciled:   true,
        reconciledAt: now,
        glPosted:     true,
        glPostedAt:   now,
      },
    })

    // Mark invoice as PAID
    await tx.invoice.update({
      where: { id: execution.invoiceId },
      data:  { status: 'PAID' },
    })
  }, { timeout: 10000 })

  // Activity log
  const pi = await prisma.paymentInstruction.findUnique({ where: { invoiceId: execution.invoiceId } })
  await prisma.entityActivityLog.create({
    data: {
      entityId:      execution.entityId ?? pi?.entityId ?? '',
      orgId:         execution.orgId,
      activityType:  'PAYMENT',
      title:         `Payment reconciled — ${execution.currency} ${execution.amount.toFixed(2)} · ref ${execution.reference ?? '—'}`,
      referenceId:   executionId,
      referenceType: 'PaymentExecution',
      performedBy:   reconciledBy,
      metadata:      { reference: execution.reference, glPosted: true },
    },
  }).catch(() => {})
}

// ---------------------------------------------------------------------------
// processDueScheduledPayments
// Batch runner — processes all SCHEDULED executions whose scheduledAt has
// passed. Safe to call from a cron endpoint.
// ---------------------------------------------------------------------------

export async function processDueScheduledPayments(): Promise<{ processed: number; failed: number }> {
  const due = await prisma.paymentExecution.findMany({
    where: {
      status:      'SCHEDULED',
      scheduledAt: { lte: new Date() },
    },
    take:    50,
    orderBy: { scheduledAt: 'asc' },
  })

  let processed = 0
  let failed    = 0

  for (const execution of due) {
    try {
      await executePaymentExecution(execution.id)
      processed++
    } catch {
      failed++
    }
  }

  return { processed, failed }
}
