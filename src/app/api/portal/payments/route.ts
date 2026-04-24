// src/app/api/portal/payments/route.ts
// GET — payment executions for the portal user's linked entity

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

    const [total, payments] = await Promise.all([
      prisma.paymentExecution.count({ where }),
      prisma.paymentExecution.findMany({
        where,
        orderBy: { scheduledAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, amount: true, currency: true, rail: true,
          status: true, scheduledAt: true, executedAt: true,
          invoice: { select: { id: true, invoiceNo: true } },
        },
      }),
    ])

    return NextResponse.json({
      payments: payments.map(p => ({
        id:          p.id,
        amount:      Number(p.amount),
        currency:    p.currency,
        rail:        p.rail,
        status:      p.status,
        scheduledAt: p.scheduledAt?.toISOString() ?? null,
        executedAt:  p.executedAt?.toISOString() ?? null,
        invoice:     p.invoice,
      })),
      total,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/portal/payments')
  }
}
