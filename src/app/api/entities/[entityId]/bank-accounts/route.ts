import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateBankAccountSchema = z.object({
  label:       z.string().min(1),
  accountName: z.string().min(1),
  accountNo:   z.string().min(1),
  currency:    z.string().min(1),
  paymentRail: z.string().min(1),
  routingNo:   z.string().optional(),
  swiftBic:    z.string().optional(),
  iban:        z.string().optional(),
})

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR', 'LEGAL', 'CISO'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

const VALID_PAYMENT_RAILS = new Set(['ACH', 'BACS', 'SWIFT', 'SEPA', 'WIRE', 'STRIPE', 'ERP', 'OTHER'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const bankAccounts = await prisma.entityBankAccount.findMany({
      where:   { entityId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({ bankAccounts })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/bank-accounts')
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const rawBody = await req.json()
    const parsed = CreateBankAccountSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    const label       = sanitiseString(body.label       ?? '', 200)
    const accountName = sanitiseString(body.accountName ?? '', 200)
    const accountNo   = sanitiseString(body.accountNo   ?? '', 100)
    const currency    = sanitiseString(body.currency    ?? '', 10).toUpperCase()
    const paymentRail = sanitiseString(body.paymentRail ?? '', 20).toUpperCase()
    const routingNo   = body.routingNo ? sanitiseString(body.routingNo, 50)  : undefined
    const swiftBic    = body.swiftBic  ? sanitiseString(body.swiftBic,  20)  : undefined
    const iban        = body.iban      ? sanitiseString(body.iban,       50)  : undefined

    if (!VALID_PAYMENT_RAILS.has(paymentRail)) {
      throw new ValidationError(`paymentRail must be one of: ${[...VALID_PAYMENT_RAILS].join(', ')}`)
    }

    const existingCount = await prisma.entityBankAccount.count({ where: { entityId } })
    const isPrimary = existingCount === 0

    const bankAccount = await prisma.entityBankAccount.create({
      data: {
        entityId,
        label,
        accountName,
        accountNo,
        currency,
        paymentRail: paymentRail as never,
        routingNo,
        swiftBic,
        iban,
        isPrimary,
      },
    })

    return NextResponse.json({ bankAccount }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities/[entityId]/bank-accounts')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const body = await req.json() as Record<string, unknown>
    const bankAccountId = sanitiseString(body.bankAccountId ?? '', 100)
    if (!bankAccountId) throw new ValidationError('bankAccountId is required')

    const account = await prisma.entityBankAccount.findFirst({
      where: { id: bankAccountId, entityId },
    })
    if (!account) throw new NotFoundError('Bank account not found')

    if (account.isPrimary) {
      const otherCount = await prisma.entityBankAccount.count({
        where: { entityId, id: { not: bankAccountId } },
      })
      if (otherCount > 0) {
        throw new ValidationError('Cannot delete the primary account while other accounts exist. Reassign primary first.')
      }
    }

    await prisma.entityBankAccount.delete({ where: { id: bankAccountId } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/entities/[entityId]/bank-accounts')
  }
}
