import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { writeAuditEvent } from '@/lib/audit'
import { encrypt, decrypt, isEncrypted } from '@/lib/crypto/field-encryption'

// ---------------------------------------------------------------------------
// Rail-specific validation via discriminated union
//
// Field mapping (schema name ← API body name):
//   accountName  ← accountHolderName / accountName
//   routingNo    ← routingNo   (ACH: 9-digit ABA routing number)
//   swiftBic     ← swiftBic    (SWIFT: 8 or 11 char BIC)
//   iban         ← iban        (SEPA: ISO 13616 format)
//   label        ← label       (human-readable bank/account label)
//
// NOTE: `label` is required on all rails and serves as the bank name for
// SWIFT and SEPA where a descriptive bank identifier is needed.
// ---------------------------------------------------------------------------

const CURRENCY_RE = /^[A-Za-z]{3}$/
const ROUTING_RE  = /^\d{9}$/
const SWIFT_RE    = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/
// ISO 13616: 2-letter country, 2-digit check, 1–30 alphanumeric chars
const IBAN_RE     = /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/

const BaseFields = {
  label:       z.string().min(1).max(200),
  accountName: z.string().min(1).max(200),
  currency:    z.string().regex(CURRENCY_RE, 'currency must be a 3-letter ISO code (e.g. USD)'),
}

const CreateBankAccountSchema = z.discriminatedUnion('paymentRail', [
  // ACH — requires routingNo (9-digit ABA number) + accountNo
  z.object({
    ...BaseFields,
    paymentRail: z.literal('ACH'),
    accountNo:   z.string().min(1).max(100),
    routingNo:   z.string().regex(ROUTING_RE, 'routingNo must be exactly 9 digits'),
    swiftBic:    z.string().optional(),
    iban:        z.string().optional(),
  }),
  // SWIFT — requires swiftBic (8 or 11 chars) + accountNo + label (bank name)
  z.object({
    ...BaseFields,
    paymentRail: z.literal('SWIFT'),
    accountNo:   z.string().min(1).max(100),
    swiftBic:    z.string().regex(SWIFT_RE, 'swiftBic must be 8 or 11 characters (XXXXXX00 or XXXXXX00XXX)'),
    routingNo:   z.string().optional(),
    iban:        z.string().optional(),
  }),
  // SEPA — requires iban (ISO 13616) + label (bank name); accountNo defaults to iban value
  z.object({
    ...BaseFields,
    paymentRail: z.literal('SEPA'),
    iban:        z.string().regex(IBAN_RE, 'iban must start with 2 letters, 2 digits, then up to 30 alphanumeric characters'),
    accountNo:   z.string().optional(),
    routingNo:   z.string().optional(),
    swiftBic:    z.string().optional(),
  }),
  // BACS — requires accountNo (UK sort code + account)
  z.object({
    ...BaseFields,
    paymentRail: z.literal('BACS'),
    accountNo:   z.string().min(1).max(100),
    routingNo:   z.string().optional(),
    swiftBic:    z.string().optional(),
    iban:        z.string().optional(),
  }),
  // WIRE — requires accountNo
  z.object({
    ...BaseFields,
    paymentRail: z.literal('WIRE'),
    accountNo:   z.string().min(1).max(100),
    routingNo:   z.string().optional(),
    swiftBic:    z.string().optional(),
    iban:        z.string().optional(),
  }),
  // STRIPE — requires accountNo
  z.object({
    ...BaseFields,
    paymentRail: z.literal('STRIPE'),
    accountNo:   z.string().min(1).max(100),
    routingNo:   z.string().optional(),
    swiftBic:    z.string().optional(),
    iban:        z.string().optional(),
  }),
  // ERP — requires accountNo
  z.object({
    ...BaseFields,
    paymentRail: z.literal('ERP'),
    accountNo:   z.string().min(1).max(100),
    routingNo:   z.string().optional(),
    swiftBic:    z.string().optional(),
    iban:        z.string().optional(),
  }),
  // OTHER — requires accountNo
  z.object({
    ...BaseFields,
    paymentRail: z.literal('OTHER'),
    accountNo:   z.string().min(1).max(100),
    routingNo:   z.string().optional(),
    swiftBic:    z.string().optional(),
    iban:        z.string().optional(),
  }),
])

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR', 'LEGAL', 'CISO'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

// ---------------------------------------------------------------------------
// GET — list all bank accounts for an entity
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const bankAccounts = await prisma.entityBankAccount.findMany({
      where:   { entityId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    })

    // Decrypt sensitive fields — backward compatible: plain values returned as-is
    const decrypted = bankAccounts.map(acct => ({
      ...acct,
      accountNo: acct.accountNo && isEncrypted(acct.accountNo) ? decrypt(acct.accountNo) : acct.accountNo,
      routingNo: acct.routingNo && isEncrypted(acct.routingNo) ? decrypt(acct.routingNo) : acct.routingNo,
      iban:      acct.iban      && isEncrypted(acct.iban)      ? decrypt(acct.iban)      : acct.iban,
      swiftBic:  acct.swiftBic  && isEncrypted(acct.swiftBic)  ? decrypt(acct.swiftBic)  : acct.swiftBic,
    }))

    return NextResponse.json({ bankAccounts: decrypted })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/bank-accounts')
  }
}

// ---------------------------------------------------------------------------
// POST — add a bank account with rail-specific field validation
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: orgId },
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
    const currency    = sanitiseString(body.currency    ?? '', 10).toUpperCase()
    const paymentRail = body.paymentRail

    const routingNoRaw = 'routingNo' in body && body.routingNo ? sanitiseString(body.routingNo, 50)  : undefined
    const swiftBicRaw  = 'swiftBic'  in body && body.swiftBic  ? sanitiseString(body.swiftBic,  20)  : undefined
    const ibanRaw      = 'iban'      in body && body.iban      ? sanitiseString(body.iban,       50)  : undefined
    // SEPA: use IBAN as accountNo when no explicit accountNo provided
    const accountNoRaw = 'accountNo' in body && body.accountNo
      ? sanitiseString(body.accountNo, 100)
      : (paymentRail === 'SEPA' && ibanRaw ? ibanRaw : '')

    // Encrypt sensitive fields before persisting
    const accountNo = accountNoRaw ? encrypt(accountNoRaw) : accountNoRaw
    const routingNo = routingNoRaw ? encrypt(routingNoRaw) : routingNoRaw
    const iban      = ibanRaw      ? encrypt(ibanRaw)      : ibanRaw
    const swiftBic  = swiftBicRaw  ? encrypt(swiftBicRaw)  : swiftBicRaw

    if (!accountNo && paymentRail !== 'SEPA') {
      throw new ValidationError('accountNo is required')
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

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      orgId,
      action:     'CREATE',
      objectType: 'BANK_ACCOUNT',
      objectId:   bankAccount.id,
    })

    return NextResponse.json({ bankAccount }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities/[entityId]/bank-accounts')
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a bank account (primary guard enforced)
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: orgId },
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

    void writeAuditEvent(prisma, {
      actorId:    session.userId,
      orgId:      orgId,
      action:     'DELETE',
      objectType: 'BANK_ACCOUNT',
      objectId:   bankAccountId,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/entities/[entityId]/bank-accounts')
  }
}
