// src/app/api/merged-authorizations/[id]/route.ts
// GET    — full detail with items
// PUT    — edit DRAFT (name, notes)
// DELETE — delete DRAFT only

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const EDIT_ROLES    = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER'])

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const ma = await prisma.mergedAuthorization.findUnique({
      where: { id: params.id },
      include: {
        items: {
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNo: true,
                amount: true,
                currency: true,
                status: true,
                invoiceDate: true,
                entity: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    })

    if (!ma || ma.orgId !== session.orgId) throw new NotFoundError('Merged authorization not found')

    // Resolve user names
    const userIds = new Set([ma.createdBy, ma.approvedBy].filter(Boolean) as string[])
    const users = userIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    return NextResponse.json({
      id:           ma.id,
      reference:    ma.reference,
      name:         ma.name,
      totalAmount:  Number(ma.totalAmount),
      creditAmount: Number(ma.creditAmount),
      netAmount:    Number(ma.netAmount),
      currency:     ma.currency,
      status:       ma.status,
      notes:        ma.notes,
      createdAt:    ma.createdAt.toISOString(),
      updatedAt:    ma.updatedAt.toISOString(),
      approvedAt:   ma.approvedAt?.toISOString() ?? null,
      creator:      userMap[ma.createdBy] ?? null,
      approver:     ma.approvedBy ? (userMap[ma.approvedBy] ?? null) : null,
      items: ma.items.map(item => ({
        id:        item.id,
        isCredit:  item.isCredit,
        amount:    Number(item.amount),
        notes:     item.notes,
        invoice:   {
          id:          item.invoice.id,
          invoiceNo:   item.invoice.invoiceNo,
          amount:      Number(item.invoice.amount),
          currency:    item.invoice.currency,
          status:      item.invoice.status,
          invoiceDate: item.invoice.invoiceDate?.toISOString() ?? null,
          entity:      item.invoice.entity,
        },
      })),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/merged-authorizations/[id]')
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!EDIT_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const ma = await prisma.mergedAuthorization.findUnique({ where: { id: params.id } })
    if (!ma || ma.orgId !== session.orgId) throw new NotFoundError('Merged authorization not found')
    if (ma.status !== 'DRAFT') throw new ValidationError('Only DRAFT merged authorizations can be edited')

    const body = await req.json()
    const data: Record<string, unknown> = {}
    if (body.name  !== undefined) data.name  = body.name  ? sanitiseString(body.name)  : null
    if (body.notes !== undefined) data.notes = body.notes ? sanitiseString(body.notes) : null

    const updated = await prisma.mergedAuthorization.update({
      where: { id: params.id },
      data,
    })

    return NextResponse.json({ id: updated.id })
  } catch (err) {
    return handleApiError(err, 'PUT /api/merged-authorizations/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!EDIT_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const ma = await prisma.mergedAuthorization.findUnique({ where: { id: params.id } })
    if (!ma || ma.orgId !== session.orgId) throw new NotFoundError('Merged authorization not found')
    if (ma.status !== 'DRAFT') throw new ValidationError('Only DRAFT merged authorizations can be deleted')

    await prisma.$transaction(async tx => {
      await tx.mergedAuthItem.deleteMany({ where: { mergedAuthId: params.id } })
      await tx.mergedAuthorization.delete({ where: { id: params.id } })
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/merged-authorizations/[id]')
  }
}
