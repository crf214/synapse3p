// src/app/api/portal/payments/route.ts
// GET — payment instructions for the portal user's linked entity

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const PORTAL_ROLES = new Set(['VENDOR', 'CLIENT'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rel = await prisma.entityOrgRelationship.findFirst({
      where: { portalUserId: session.userId },
    })
    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    const { searchParams } = new URL(req.url)
    const page     = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = 20

    const where = { entityId: rel.entityId, orgId: rel.orgId }

    const [total, instructions] = await Promise.all([
      prisma.paymentInstruction.count({ where }),
      prisma.paymentInstruction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, invoiceId: true, amount: true, currency: true,
          status: true, dueDate: true, confirmedAt: true, erpReference: true,
          poReference: true,
        },
      }),
    ])

    // Fetch invoice numbers for these instructions
    const invoiceIds = [...new Set(instructions.map(i => i.invoiceId))]
    const invoices   = invoiceIds.length > 0
      ? await prisma.invoice.findMany({
          where:  { id: { in: invoiceIds } },
          select: { id: true, invoiceNo: true },
        })
      : []
    const invoiceMap = new Map(invoices.map(i => [i.id, i.invoiceNo]))

    return NextResponse.json({
      payments: instructions.map(p => ({
        id:            p.id,
        paymentRef:    p.erpReference ?? p.poReference ?? p.id.slice(-8).toUpperCase(),
        invoiceId:     p.invoiceId,
        invoiceNo:     invoiceMap.get(p.invoiceId) ?? '—',
        amount:        Number(p.amount),
        currency:      p.currency,
        status:        p.status,
        scheduledDate: p.dueDate?.toISOString()     ?? null,
        paidDate:      p.confirmedAt?.toISOString() ?? null,
      })),
      total,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/portal/payments')
  }
}
