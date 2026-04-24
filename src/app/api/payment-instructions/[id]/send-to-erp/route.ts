// src/app/api/payment-instructions/[id]/send-to-erp/route.ts
// POST — submit an APPROVED payment instruction to the ERP
// Creates a PaymentExecution record and marks PI as SENT_TO_ERP

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

const SUBMIT_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO', 'FINANCE_MANAGER'])

type Params = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!SUBMIT_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const pi = await prisma.paymentInstruction.findUnique({ where: { id: params.id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')
    if (pi.status !== 'APPROVED') {
      throw new ValidationError(`Payment instruction must be APPROVED before sending to ERP (current: ${pi.status})`)
    }

    // Determine payment rail from bank account
    const bankAccount = await prisma.entityBankAccount.findUnique({
      where: { id: pi.bankAccountId },
      select: { paymentRail: true },
    })

    // Map PaymentRail → PaymentRailExecution
    const railMap: Record<string, 'ERP' | 'BANK_API' | 'STRIPE'> = {
      ACH:        'BANK_API',
      WIRE:       'BANK_API',
      SEPA:       'BANK_API',
      SWIFT:      'BANK_API',
      CHECK:      'ERP',
      INTERNAL:   'ERP',
      STRIPE:     'STRIPE',
      OTHER:      'ERP',
    }
    const rail = railMap[bankAccount?.paymentRail ?? ''] ?? 'ERP'

    await prisma.$transaction(async tx => {
      // Create execution record
      await tx.paymentExecution.create({
        data: {
          invoiceId:    pi.invoiceId,
          orgId:        pi.orgId,
          entityId:     pi.entityId,
          bankAccountId:pi.bankAccountId,
          amount:       pi.amount,
          currency:     pi.currency,
          rail,
          status:       'SCHEDULED',
          scheduledAt:  pi.dueDate ?? new Date(),
          metadata:     {},
        },
      })

      // Mark PI as sent
      await tx.paymentInstruction.update({
        where: { id: params.id },
        data: {
          status:      'SENT_TO_ERP',
          sentToErpAt: new Date(),
          erpReference:`ERP-${Date.now()}`, // real implementation would call ERP adapter
        },
      })
    }, { timeout: 15000 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/send-to-erp')
  }
}
