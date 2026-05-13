// src/app/api/payment-instructions/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'

const CreatePaymentInstructionSchema = z.object({
  invoiceId:     z.string().min(1),
  bankAccountId: z.string().min(1),
  amount:        z.number().optional(),
  currency:      z.string().optional(),
  dueDate:       z.string().optional().nullable(),
  glCode:        z.string().optional().nullable(),
  costCentre:    z.string().optional().nullable(),
  poReference:   z.string().optional().nullable(),
  notes:         z.string().optional().nullable(),
})

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    const orgId = session.orgId
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const status   = searchParams.get('status')   ?? undefined
    const entityId = searchParams.get('entityId') ?? undefined
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const limit    = 50

    const where: Record<string, unknown> = { orgId }
    if (status)   where.status   = status
    if (entityId) where.entityId = entityId

    const [total, rows] = await Promise.all([
      prisma.paymentInstruction.count({ where }),
      prisma.paymentInstruction.findMany({
        where,
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id:             true,
          invoiceId:      true,
          entityId:       true,
          bankAccountId:  true,
          amount:         true,
          currency:       true,
          dueDate:        true,
          status:         true,
          currentVersion: true,
          glCode:         true,
          costCentre:     true,
          poReference:    true,
          erpReference:   true,
          approvedAt:     true,
          sentToErpAt:    true,
          confirmedAt:    true,
          createdAt:      true,
          createdBy:      true,
          approvedBy:     true,
        },
      }),
    ])

    // Batch-resolve entity names, invoice numbers, creator names
    const entityIds  = [...new Set(rows.map(r => r.entityId))]
    const invoiceIds = [...new Set(rows.map(r => r.invoiceId))]
    const userIds    = [...new Set([...rows.map(r => r.createdBy), ...rows.map(r => r.approvedBy).filter(Boolean) as string[]])]

    const [entities, invoices, users] = await Promise.all([
      prisma.entity.findMany({  where: { id: { in: entityIds  } }, select: { id: true, name: true } }),
      prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNo: true, amount: true } }),
      prisma.user.findMany({    where: { id: { in: userIds    } }, select: { id: true, name: true, email: true } }),
    ])

    const entityMap  = Object.fromEntries(entities.map(e => [e.id, e]))
    const invoiceMap = Object.fromEntries(invoices.map(i => [i.id, i]))
    const userMap    = Object.fromEntries(users.map(u => [u.id, u]))

    const payments = rows.map(r => ({
      ...r,
      amount:       Number(r.amount),
      dueDate:      r.dueDate?.toISOString()      ?? null,
      approvedAt:   r.approvedAt?.toISOString()   ?? null,
      sentToErpAt:  r.sentToErpAt?.toISOString()  ?? null,
      confirmedAt:  r.confirmedAt?.toISOString()  ?? null,
      createdAt:    r.createdAt.toISOString(),
      entity:       entityMap[r.entityId]    ?? { id: r.entityId,   name: '—' },
      invoice:      invoiceMap[r.invoiceId]  ?? { id: r.invoiceId,  invoiceNo: '—', amount: 0 },
      creator:      userMap[r.createdBy]     ?? null,
      approver:     r.approvedBy ? userMap[r.approvedBy] ?? null : null,
    }))

    return NextResponse.json({ payments, total, page, limit })
  } catch (err) {
    return handleApiError(err, 'GET /api/payment-instructions')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    const orgId = session.orgId
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreatePaymentInstructionSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data
    const { invoiceId, bankAccountId } = body

    // Validate invoice exists, belongs to org, and is APPROVED
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, orgId },
      select: { id: true, entityId: true, amount: true, currency: true, status: true, invoiceNo: true },
    })
    if (!invoice) throw new ValidationError('Invoice not found')
    if (!['APPROVED', 'MATCHED'].includes(invoice.status)) {
      throw new ValidationError(`Invoice must be APPROVED or MATCHED before creating a payment instruction (current: ${invoice.status})`)
    }

    // Prevent duplicate payment instructions for the same invoice
    const existing = await prisma.paymentInstruction.findFirst({
      where: { invoiceId, orgId, status: { notIn: ['CANCELLED', 'FAILED'] } },
    })
    if (existing) throw new ValidationError('A payment instruction already exists for this invoice')

    // Validate bank account belongs to entity
    const bankAccount = await prisma.entityBankAccount.findFirst({
      where: { id: bankAccountId, entityId: invoice.entityId },
      select: { id: true, currency: true },
    })
    if (!bankAccount) throw new ValidationError('Bank account not found for this entity')

    const pi = await prisma.$transaction(async tx => {
      const payment = await tx.paymentInstruction.create({
        data: {
          orgId,
          invoiceId,
          entityId:     invoice.entityId,
          bankAccountId,
          amount:       body.amount     !== undefined ? Number(body.amount) : Number(invoice.amount),
          currency:     body.currency   ?? invoice.currency,
          dueDate:      body.dueDate    ? new Date(body.dueDate) : null,
          glCode:       body.glCode     ? sanitiseString(body.glCode)     : null,
          costCentre:   body.costCentre ? sanitiseString(body.costCentre) : null,
          poReference:  body.poReference? sanitiseString(body.poReference): null,
          notes:        body.notes      ? sanitiseString(body.notes)      : null,
          createdBy:    session.userId!,
          status:       'DRAFT',
          currentVersion: 1,
        },
      })

      // Create initial version snapshot
      await tx.paymentInstructionVersion.create({
        data: {
          paymentInstructionId: payment.id,
          version:              1,
          entityId:             invoice.entityId,
          bankAccountId,
          amount:               body.amount !== undefined ? Number(body.amount) : Number(invoice.amount),
          currency:             body.currency ?? invoice.currency,
          dueDate:              body.dueDate ? new Date(body.dueDate) : null,
          glCode:               body.glCode ?? null,
          costCentre:           body.costCentre ?? null,
          snapshotBy:           session.userId!,
          changeReason:         'Initial creation',
        },
      })

      await writeAuditEvent(tx, {
        actorId:    session.userId!,
        orgId:      orgId,
        action:     'CREATE',
        objectType: 'PAYMENT',
        objectId:   payment.id,
      })

      return payment
    }, { timeout: 15000 })

    return NextResponse.json(pi, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/payment-instructions')
  }
}
