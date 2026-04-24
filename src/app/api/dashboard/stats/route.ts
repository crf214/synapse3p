// src/app/api/dashboard/stats/route.ts
// GET — aggregated counts for the home dashboard

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError } from '@/lib/errors'

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()

    const orgId = session.orgId

    const [
      entityCount,
      invoiceRows,
      poRows,
      reviewRows,
      pendingPayments,
      activeSignals,
      openIngestionFailures,
      recentActivity,
      controlHealth,
    ] = await Promise.all([
      // Entities
      prisma.entity.count({ where: { masterOrgId: orgId } }),

      // Invoices by status
      prisma.invoice.groupBy({
        by: ['status'],
        where: { orgId },
        _count: true,
      }),

      // POs by status
      prisma.purchaseOrder.groupBy({
        by: ['status'],
        where: { orgId },
        _count: true,
      }),

      // Reviews by status
      prisma.thirdPartyReview.groupBy({
        by: ['status'],
        where: { orgId },
        _count: true,
      }),

      // Payment instructions pending
      prisma.paymentInstruction.count({
        where: { orgId, status: { in: ['PENDING_APPROVAL', 'DRAFT'] } },
      }),

      // Unread external signals
      prisma.externalSignal.count({
        where: { orgId, dismissed: false },
      }),

      // Failed ingestion events
      prisma.invoiceIngestionEvent.count({
        where: { orgId, processingStatus: 'FAILED' },
      }),

      // Recent entity activity logs (last 10)
      prisma.entityActivityLog.findMany({
        where: { orgId },
        orderBy: { occurredAt: 'desc' },
        take: 10,
        select: {
          id:           true,
          activityType: true,
          title:        true,
          description:  true,
          occurredAt:   true,
          entity: { select: { id: true, name: true } },
        },
      }),

      // Control health: pass vs fail (last 30 days)
      prisma.controlTestResult.groupBy({
        by: ['status'],
        where: {
          orgId,
          testedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _count: true,
      }),
    ])

    // Roll up invoice counts
    const invoiceCounts: Record<string, number> = {}
    for (const row of invoiceRows) invoiceCounts[row.status] = row._count
    const pendingInvoices = (invoiceCounts['RECEIVED'] ?? 0) + (invoiceCounts['PENDING_REVIEW'] ?? 0)
    const totalInvoices   = Object.values(invoiceCounts).reduce((a, b) => a + b, 0)

    // Roll up PO counts
    const poCounts: Record<string, number> = {}
    for (const row of poRows) poCounts[row.status] = row._count
    const pendingPOs = poCounts['PENDING_APPROVAL'] ?? 0
    const totalPOs   = Object.values(poCounts).reduce((a, b) => a + b, 0)

    // Roll up review counts
    const reviewCounts: Record<string, number> = {}
    for (const row of reviewRows) reviewCounts[row.status] = row._count
    const overdueReviews = reviewCounts['OVERDUE'] ?? 0
    const openReviews    = (reviewCounts['SCHEDULED'] ?? 0) + (reviewCounts['IN_PROGRESS'] ?? 0) + overdueReviews

    // Control pass rate
    const passCount  = controlHealth.find(r => r.status === 'PASS')?._count ?? 0
    const failCount  = controlHealth.find(r => r.status === 'FAIL')?._count ?? 0
    const totalTests = controlHealth.reduce((sum, r) => sum + r._count, 0)

    return NextResponse.json({
      entities:        entityCount,
      invoices: {
        total:   totalInvoices,
        pending: pendingInvoices,
        byStatus: invoiceCounts,
      },
      purchaseOrders: {
        total:   totalPOs,
        pending: pendingPOs,
        byStatus: poCounts,
      },
      reviews: {
        total:   Object.values(reviewCounts).reduce((a, b) => a + b, 0),
        open:    openReviews,
        overdue: overdueReviews,
      },
      payments: {
        pending: pendingPayments,
      },
      signals: {
        active: activeSignals,
      },
      ingestion: {
        failures: openIngestionFailures,
      },
      controls: {
        passRate:   totalTests > 0 ? Math.round((passCount / totalTests) * 100) : null,
        passCount,
        failCount,
        totalTests,
      },
      recentActivity: recentActivity.map(a => ({
        id:          a.id,
        type:        a.activityType,
        title:       a.title,
        description: a.description ?? a.title,
        createdAt:   a.occurredAt.toISOString(),
        entity:      a.entity,
      })),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/dashboard/stats')
  }
}
