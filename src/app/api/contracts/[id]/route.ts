// src/app/api/contracts/[id]/route.ts — GET (detail) + PUT (update)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])
const READ_ROLES  = new Set([...WRITE_ROLES, 'AP_CLERK', 'AUDITOR'])

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const contract = await prisma.contract.findUnique({
      where: { id },
    })
    if (!contract || contract.orgId !== session.orgId) throw new NotFoundError('Contract not found')

    // Fetch related data in parallel
    const [entity, owner, linkedPo, document, invoices] = await Promise.all([
      prisma.entity.findUnique({ where: { id: contract.entityId }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: contract.ownedBy }, select: { id: true, name: true, email: true } }),
      contract.linkedPoId
        ? prisma.purchaseOrder.findUnique({ where: { id: contract.linkedPoId }, select: { id: true, poNumber: true, title: true, status: true } })
        : null,
      prisma.document.findUnique({ where: { id: contract.documentId }, select: { id: true, title: true, storageRef: true, mimeType: true, fileSizeBytes: true, eSignStatus: true, eSignRequired: true, createdAt: true } }),
      prisma.invoice.findMany({
        where: { contractId: contract.id },
        select: { id: true, invoiceNo: true, amount: true, currency: true, status: true, invoiceDate: true },
        orderBy: { invoiceDate: 'desc' },
        take: 50,
      }),
    ])

    return NextResponse.json({
      ...contract,
      value:       contract.value !== null ? Number(contract.value) : null,
      startDate:   contract.startDate?.toISOString()  ?? null,
      endDate:     contract.endDate?.toISOString()    ?? null,
      renewalDate: contract.renewalDate?.toISOString()?? null,
      reviewedAt:  contract.reviewedAt?.toISOString() ?? null,
      createdAt:   contract.createdAt.toISOString(),
      updatedAt:   contract.updatedAt.toISOString(),
      entity,
      owner,
      linkedPo,
      document: document ? { ...document, createdAt: document.createdAt.toISOString() } : null,
      invoices: invoices.map(i => ({
        ...i,
        amount:      Number(i.amount),
        invoiceDate: i.invoiceDate?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const contract = await prisma.contract.findUnique({ where: { id } })
    if (!contract || contract.orgId !== session.orgId) throw new NotFoundError('Contract not found')

    const body = await req.json()

    const VALID_TYPES    = ['MASTER','SOW','AMENDMENT','NDA','SLA','FRAMEWORK','OTHER']
    const VALID_STATUSES = ['DRAFT','ACTIVE','EXPIRED','TERMINATED','UNDER_REVIEW','RENEWED']

    if (body.type   && !VALID_TYPES.includes(body.type))    throw new ValidationError('Invalid type')
    if (body.status && !VALID_STATUSES.includes(body.status)) throw new ValidationError('Invalid status')

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        ...(body.type            && { type: body.type }),
        ...(body.status          && { status: body.status }),
        ...(body.value !== undefined  && { value: body.value !== '' && body.value !== null ? Number(body.value) : null }),
        ...(body.currency        && { currency: sanitiseString(body.currency) }),
        ...(body.startDate  !== undefined && { startDate:   body.startDate   ? new Date(body.startDate)   : null }),
        ...(body.endDate    !== undefined && { endDate:     body.endDate     ? new Date(body.endDate)     : null }),
        ...(body.renewalDate!== undefined && { renewalDate: body.renewalDate ? new Date(body.renewalDate) : null }),
        ...(body.autoRenew  !== undefined && { autoRenew:   Boolean(body.autoRenew) }),
        ...(body.noticePeriodDays !== undefined && { noticePeriodDays: Number(body.noticePeriodDays) }),
        ...(body.linkedPoId !== undefined && { linkedPoId: body.linkedPoId ?? null }),
        ...(body.notes      !== undefined && { notes: body.notes ? sanitiseString(body.notes) : null }),
        ...(body.reviewedAt !== undefined && { reviewedAt: body.reviewedAt ? new Date(body.reviewedAt) : null }),
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!['ADMIN', 'CFO'].includes(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const contract = await prisma.contract.findUnique({ where: { id } })
    if (!contract || contract.orgId !== session.orgId) throw new NotFoundError('Contract not found')

    // Only allow deleting DRAFT contracts
    if (contract.status !== 'DRAFT') throw new ValidationError('Only DRAFT contracts can be deleted')

    await prisma.contract.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, "")
  }
}
