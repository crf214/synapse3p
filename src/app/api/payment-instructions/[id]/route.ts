// src/app/api/payment-instructions/[id]/route.ts — GET (detail) + PUT (edit DRAFT)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { FINANCE_ROLES } from '@/lib/security/roles'

const UpdatePaymentInstructionSchema = z.object({
  bankAccountId: z.string().optional(),
  amount:        z.number().optional(),
  currency:      z.string().optional(),
  dueDate:       z.string().nullable().optional(),
  glCode:        z.string().nullable().optional(),
  costCentre:    z.string().nullable().optional(),
  poReference:   z.string().nullable().optional(),
  notes:         z.string().nullable().optional(),
  changeReason:  z.string().optional(),
})

const READ_ROLES  = FINANCE_ROLES
const WRITE_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({
      where: { id },
      include: {
        versions:   { orderBy: { version: 'asc' } },
        amendments: { orderBy: { requestedAt: 'desc' } },
      },
    })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')

    // Batch-fetch related records
    const userIds = [
      pi.createdBy, pi.approvedBy,
      ...pi.amendments.map(a => a.requestedBy),
      ...pi.amendments.map(a => a.reviewedBy).filter(Boolean) as string[],
      ...pi.versions.map(v => v.snapshotBy),
    ].filter(Boolean) as string[]

    const [entity, invoice, bankAccount, users] = await Promise.all([
      prisma.entity.findUnique({ where: { id: pi.entityId }, select: { id: true, name: true } }),
      prisma.invoice.findUnique({ where: { id: pi.invoiceId }, select: { id: true, invoiceNo: true, amount: true, currency: true, status: true } }),
      prisma.entityBankAccount.findUnique({ where: { id: pi.bankAccountId }, select: { id: true, label: true, accountName: true, accountNo: true, currency: true, paymentRail: true } }),
      prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true, email: true } }),
    ])

    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    return NextResponse.json({
      ...pi,
      amount:          Number(pi.amount),
      confirmedAmount: pi.confirmedAmount !== null ? Number(pi.confirmedAmount) : null,
      dueDate:         pi.dueDate?.toISOString()      ?? null,
      approvedAt:      pi.approvedAt?.toISOString()   ?? null,
      sentToErpAt:     pi.sentToErpAt?.toISOString()  ?? null,
      confirmedAt:     pi.confirmedAt?.toISOString()  ?? null,
      cancelledAt:     pi.cancelledAt?.toISOString()  ?? null,
      createdAt:       pi.createdAt.toISOString(),
      updatedAt:       pi.updatedAt.toISOString(),
      entity,
      invoice: invoice ? { ...invoice, amount: Number(invoice.amount) } : null,
      bankAccount,
      creator:  userMap[pi.createdBy]  ?? null,
      approver: pi.approvedBy ? userMap[pi.approvedBy] ?? null : null,
      versions: pi.versions.map(v => ({
        ...v,
        amount:     Number(v.amount),
        dueDate:    v.dueDate?.toISOString() ?? null,
        snapshotAt: v.snapshotAt.toISOString(),
        snapshotByUser: userMap[v.snapshotBy] ?? null,
      })),
      amendments: pi.amendments.map(a => ({
        ...a,
        requestedAt: a.requestedAt.toISOString(),
        reviewedAt:  a.reviewedAt?.toISOString() ?? null,
        requestedByUser: userMap[a.requestedBy] ?? null,
        reviewedByUser:  a.reviewedBy ? userMap[a.reviewedBy] ?? null : null,
      })),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/payment-instructions/[id]')
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const pi = await prisma.paymentInstruction.findUnique({ where: { id } })
    if (!pi || pi.orgId !== session.orgId) throw new NotFoundError('Payment instruction not found')
    if (pi.status !== 'DRAFT') throw new ValidationError('Only DRAFT payment instructions can be edited directly')

    const rawBody = await req.json()
    const parsed = UpdatePaymentInstructionSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    // Validate bank account if changing it
    if (body.bankAccountId && body.bankAccountId !== pi.bankAccountId) {
      const ba = await prisma.entityBankAccount.findFirst({ where: { id: body.bankAccountId, entityId: pi.entityId } })
      if (!ba) throw new ValidationError('Bank account not found for this entity')
    }

    const newVersion = pi.currentVersion + 1

    const updated = await prisma.$transaction(async tx => {
      const payment = await tx.paymentInstruction.update({
        where: { id },
        data: {
          ...(body.bankAccountId !== undefined && { bankAccountId: body.bankAccountId }),
          ...(body.amount        !== undefined && { amount:        Number(body.amount) }),
          ...(body.currency      !== undefined && { currency:      sanitiseString(body.currency) }),
          ...(body.dueDate       !== undefined && { dueDate:       body.dueDate ? new Date(body.dueDate) : null }),
          ...(body.glCode        !== undefined && { glCode:        body.glCode ? sanitiseString(body.glCode) : null }),
          ...(body.costCentre    !== undefined && { costCentre:    body.costCentre ? sanitiseString(body.costCentre) : null }),
          ...(body.poReference   !== undefined && { poReference:   body.poReference ? sanitiseString(body.poReference) : null }),
          ...(body.notes         !== undefined && { notes:         body.notes ? sanitiseString(body.notes) : null }),
          currentVersion: newVersion,
        },
      })

      // Snapshot the new version
      await tx.paymentInstructionVersion.create({
        data: {
          paymentInstructionId: id,
          version:     newVersion,
          entityId:    pi.entityId,
          bankAccountId: body.bankAccountId ?? pi.bankAccountId,
          amount:      body.amount    !== undefined ? Number(body.amount)         : Number(pi.amount),
          currency:    body.currency  !== undefined ? sanitiseString(body.currency): pi.currency,
          dueDate:     body.dueDate   !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : pi.dueDate,
          glCode:      body.glCode    !== undefined ? (body.glCode ?? null)       : pi.glCode,
          costCentre:  body.costCentre!== undefined ? (body.costCentre ?? null)   : pi.costCentre,
          snapshotBy:  session.userId!,
          changeReason: body.changeReason ? sanitiseString(body.changeReason) : 'Manual edit',
        },
      })

      return payment
    }, { timeout: 15000 })

    return NextResponse.json({ ...updated, amount: Number(updated.amount) })
  } catch (err) {
    return handleApiError(err, 'PUT /api/payment-instructions/[id]')
  }
}
