// src/app/api/payment-instructions/[id]/amendments/route.ts
// POST — request an amendment to a SENT_TO_ERP or APPROVED PI
// Body: { field: AmendmentField, proposedValue: string, notes?: string }

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const AMEND_ROLES   = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const APPROVE_ROLES = new Set(['ADMIN', 'CONTROLLER', 'CFO'])

const VALID_FIELDS = ['AMOUNT', 'ENTITY', 'BANK_ACCOUNT']

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!AMEND_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')

    const AMENDABLE = ['APPROVED', 'SENT_TO_ERP', 'AMENDMENT_PENDING']
    if (!AMENDABLE.includes(pi.status)) {
      throw new ValidationError(`Amendments can only be requested on APPROVED or SENT_TO_ERP instructions (current: ${pi.status})`)
    }

    const body = await req.json()
    const field         = body.field as string
    const proposedValue = sanitiseString(body.proposedValue ?? '')
    const notes         = body.notes ? sanitiseString(body.notes) : null

    if (!VALID_FIELDS.includes(field)) throw new ValidationError('field must be AMOUNT, ENTITY, or BANK_ACCOUNT')
    if (!proposedValue) throw new ValidationError('proposedValue is required')

    // Check no open amendment for same field
    const openAmendment = await prisma.paymentInstructionAmendment.findFirst({
      where: { paymentInstructionId: id, field: field as never, status: 'PENDING' },
    })
    if (openAmendment) throw new ValidationError(`An open amendment for ${field} already exists`)

    // Derive current value for the field
    const previousValue =
      field === 'AMOUNT'       ? String(pi.amount) :
      field === 'ENTITY'       ? pi.entityId :
      field === 'BANK_ACCOUNT' ? pi.bankAccountId : ''

    const amendment = await prisma.$transaction(async tx => {
      const a = await tx.paymentInstructionAmendment.create({
        data: {
          paymentInstructionId: id,
          field:         field as never,
          previousValue,
          proposedValue,
          status:        'PENDING',
          requestedBy:   session.userId!,
          notes,
        },
      })

      await tx.paymentInstruction.update({
        where: { id },
        data:  { status: 'AMENDMENT_PENDING' },
      })

      return a
    }, { timeout: 15000 })

    return NextResponse.json(amendment, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions/[id]/amendments')
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  // Approve or reject a specific amendment
  // Body: { amendmentId: string, decision: 'APPROVED' | 'REJECTED', rejectionReason?: string }
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!APPROVE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')

    const body = await req.json()
    const { amendmentId, decision, rejectionReason } = body
    if (!amendmentId) throw new ValidationError('amendmentId is required')
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new ValidationError('decision must be APPROVED or REJECTED')

    const amendment = await prisma.paymentInstructionAmendment.findUnique({ where: { id: amendmentId } })
    if (!amendment || amendment.paymentInstructionId !== id) throw new NotFoundError('Amendment not found')
    if (amendment.status !== 'PENDING') throw new ValidationError('Amendment is no longer pending')

    await prisma.$transaction(async tx => {
      await tx.paymentInstructionAmendment.update({
        where: { id: amendmentId },
        data: {
          status:          decision,
          reviewedBy:      session.userId,
          reviewedAt:      new Date(),
          rejectionReason: decision === 'REJECTED' ? sanitiseString(rejectionReason ?? '') : null,
        },
      })

      if (decision === 'APPROVED') {
        // Apply the amendment to the payment instruction
        const newVersion = pi.currentVersion + 1
        const fieldData: Record<string, unknown> = { currentVersion: newVersion }

        if (amendment.field === 'AMOUNT')       fieldData.amount       = Number(amendment.proposedValue)
        if (amendment.field === 'ENTITY')       fieldData.entityId     = amendment.proposedValue
        if (amendment.field === 'BANK_ACCOUNT') fieldData.bankAccountId= amendment.proposedValue

        await tx.paymentInstruction.update({ where: { id }, data: fieldData })

        // Snapshot the amendment-applied version
        await tx.paymentInstructionVersion.create({
          data: {
            paymentInstructionId: id,
            version:      newVersion,
            entityId:     amendment.field === 'ENTITY'       ? amendment.proposedValue : pi.entityId,
            bankAccountId:amendment.field === 'BANK_ACCOUNT' ? amendment.proposedValue : pi.bankAccountId,
            amount:       amendment.field === 'AMOUNT'       ? Number(amendment.proposedValue) : Number(pi.amount),
            currency:     pi.currency,
            dueDate:      pi.dueDate,
            glCode:       pi.glCode,
            costCentre:   pi.costCentre,
            snapshotBy:   session.userId!,
            changeReason: `Amendment approved: ${amendment.field} changed to ${amendment.proposedValue}`,
          },
        })
      }

      // Check if any other PENDING amendments remain
      const remaining = await tx.paymentInstructionAmendment.count({
        where: { paymentInstructionId: id, status: 'PENDING' },
      })
      if (remaining === 0) {
        // Restore previous status
        await tx.paymentInstruction.update({
          where: { id },
          data:  { status: pi.status === 'AMENDMENT_PENDING' ? 'APPROVED' : pi.status },
        })
      }
    }, { timeout: 15000 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/payment-instructions/[id]/amendments')
  }
}
