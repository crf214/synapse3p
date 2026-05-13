// src/app/api/portal/invoices/route.ts
// GET — invoices belonging to the portal user's linked entity

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { PORTAL_ROLES } from '@/lib/security/roles'

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
    const status   = searchParams.get('status') ?? ''

    const where = {
      entityId: rel.entityId,
      orgId:    rel.orgId,
      ...(status ? { status: status as never } : {}),
    }

    const entityFilter = { entityId: rel.entityId, orgId: rel.orgId }

    const [total, invoices, statusRows, allDisputedRows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, invoiceNo: true, amount: true, currency: true,
          status: true, invoiceDate: true, dueDate: true, createdAt: true,
        },
      }),
      // Aggregate counts by status (always, for the home dashboard)
      prisma.invoice.groupBy({
        by:    ['status'],
        where: entityFilter,
        _count: { _all: true },
      }),
      // Dedicated total dispute count — not scoped to current page
      prisma.entityActivityLog.findMany({
        where: {
          ...entityFilter,
          referenceType: 'Invoice',
          activityType:  'NOTE',
          metadata:      { path: ['type'], equals: 'VENDOR_DISPUTE' },
        },
        select:   { referenceId: true },
        distinct: ['referenceId'],
      }),
    ])

    const invoiceIds  = invoices.map(i => i.id)
    const disputedSet = new Set(allDisputedRows.map(d => d.referenceId).filter(Boolean) as string[])
    const disputeTotal = disputedSet.size

    // Build status counts map
    const statusCounts: Record<string, number> = {}
    for (const row of statusRows) {
      statusCounts[row.status] = row._count._all
    }

    return NextResponse.json({
      invoices: invoices.map(i => ({
        ...i,
        amount:      Number(i.amount),
        invoiceDate: i.invoiceDate?.toISOString() ?? null,
        dueDate:     i.dueDate?.toISOString()     ?? null,
        createdAt:   i.createdAt.toISOString(),
        hasDispute:  invoiceIds.includes(i.id) && disputedSet.has(i.id),
      })),
      total,
      disputeTotal,
      statusCounts,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/portal/invoices')
  }
}
