// src/app/api/portal/invoices/route.ts
// GET — invoices belonging to the portal user's linked entity

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
    const status   = searchParams.get('status') ?? ''

    const where = {
      entityId: rel.entityId,
      orgId:    rel.orgId,
      ...(status ? { status: status as never } : {}),
    }

    const [total, invoices, statusRows] = await Promise.all([
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
        where: { entityId: rel.entityId, orgId: rel.orgId },
        _count: { _all: true },
      }),
    ])

    const invoiceIds = invoices.map(i => i.id)

    // Detect which invoices have open disputes (EntityActivityLog entries)
    const disputedInvoiceIds = invoiceIds.length > 0
      ? await prisma.entityActivityLog.findMany({
          where: {
            orgId:         rel.orgId,
            entityId:      rel.entityId,
            referenceType: 'Invoice',
            activityType:  'NOTE',
            referenceId:   { in: invoiceIds },
            metadata:      { path: ['type'], equals: 'VENDOR_DISPUTE' },
          },
          select: { referenceId: true },
          distinct: ['referenceId'],
        })
      : []

    const disputedSet = new Set(disputedInvoiceIds.map(d => d.referenceId).filter(Boolean) as string[])

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
        hasDispute:  disputedSet.has(i.id),
      })),
      total,
      statusCounts,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/portal/invoices')
  }
}
