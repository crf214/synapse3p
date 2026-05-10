import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// AP Aging
// ---------------------------------------------------------------------------

export interface ApAgingRow {
  currency:     string
  current:      number   // not yet due
  days1to30:    number
  days31to60:   number
  days61to90:   number
  over90:       number
  total:        number
  invoiceCount: number
}

export async function getApAgingData(orgId: string): Promise<ApAgingRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      currency:     string
      current:      number
      days1to30:    number
      days31to60:   number
      days61to90:   number
      over90:       number
      total:        number
      invoiceCount: bigint
    }>
  >(Prisma.sql`
    SELECT
      currency,
      SUM(CASE WHEN "dueDate" >= NOW() OR "dueDate" IS NULL                          THEN amount ELSE 0 END) AS current,
      SUM(CASE WHEN "dueDate" <  NOW() AND "dueDate" >= NOW() - INTERVAL '30 days'   THEN amount ELSE 0 END) AS "days1to30",
      SUM(CASE WHEN "dueDate" <  NOW() - INTERVAL '30 days' AND "dueDate" >= NOW() - INTERVAL '60 days' THEN amount ELSE 0 END) AS "days31to60",
      SUM(CASE WHEN "dueDate" <  NOW() - INTERVAL '60 days' AND "dueDate" >= NOW() - INTERVAL '90 days' THEN amount ELSE 0 END) AS "days61to90",
      SUM(CASE WHEN "dueDate" <  NOW() - INTERVAL '90 days'                          THEN amount ELSE 0 END) AS "over90",
      SUM(amount)   AS total,
      COUNT(*)      AS "invoiceCount"
    FROM invoices
    WHERE "orgId" = ${orgId}
      AND status NOT IN ('PAID', 'CANCELLED')
    GROUP BY currency
    ORDER BY currency
  `)

  return rows.map(r => ({
    ...r,
    invoiceCount: Number(r.invoiceCount),
  }))
}

// ---------------------------------------------------------------------------
// Spend by Vendor
// ---------------------------------------------------------------------------

export interface SpendByVendorRow {
  entityId:        string
  entityName:      string
  currency:        string
  totalAmount:     number
  invoiceCount:    number
  paidCount:       number
  pendingCount:    number
  lastInvoiceDate: Date | null
}

export async function getSpendByVendor(
  orgId:       string,
  periodStart: Date,
  periodEnd:   Date,
): Promise<SpendByVendorRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      entityId:        string
      entityName:      string
      currency:        string
      totalAmount:     number
      invoiceCount:    bigint
      paidCount:       bigint
      pendingCount:    bigint
      lastInvoiceDate: Date | null
    }>
  >(Prisma.sql`
    SELECT
      i."entityId",
      e.name            AS "entityName",
      i.currency,
      SUM(i.amount)     AS "totalAmount",
      COUNT(*)          AS "invoiceCount",
      COUNT(*) FILTER (WHERE i.status = 'PAID')    AS "paidCount",
      COUNT(*) FILTER (WHERE i.status NOT IN ('PAID', 'CANCELLED')) AS "pendingCount",
      MAX(i."dueDate")  AS "lastInvoiceDate"
    FROM invoices i
    JOIN entities e ON e.id = i."entityId"
    WHERE i."orgId"  = ${orgId}
      AND i."dueDate" >= ${periodStart}
      AND i."dueDate" <= ${periodEnd}
    GROUP BY i."entityId", e.name, i.currency
    ORDER BY "totalAmount" DESC
  `)

  return rows.map(r => ({
    ...r,
    invoiceCount: Number(r.invoiceCount),
    paidCount:    Number(r.paidCount),
    pendingCount: Number(r.pendingCount),
  }))
}

// ---------------------------------------------------------------------------
// Risk Dashboard
// ---------------------------------------------------------------------------

export interface RiskDashboardData {
  highRiskCount:     number
  mediumRiskCount:   number
  lowRiskCount:      number
  overdueReviews:    number
  pendingOnboarding: number
  criticalSignals:   number
  topRiskEntities:   Array<{
    entityId:       string
    name:           string
    riskScore:      number
    lastReviewDate: Date | null
  }>
}

export async function getRiskDashboardData(orgId: string): Promise<RiskDashboardData> {
  const [riskCounts, overdueReviews, pendingOnboarding, criticalSignals, topRiskEntities] =
    await Promise.all([
      // Risk score buckets — latest score per entity
      prisma.$queryRaw<Array<{ bucket: string; cnt: bigint }>>(Prisma.sql`
        SELECT
          CASE
            WHEN rs."computedScore" >= 7   THEN 'high'
            WHEN rs."computedScore" >= 4   THEN 'medium'
            ELSE 'low'
          END AS bucket,
          COUNT(*) AS cnt
        FROM entity_risk_scores rs
        JOIN entities e ON e.id = rs."entityId"
        WHERE e."masterOrgId" = ${orgId}
          AND rs.id = (
            SELECT id FROM entity_risk_scores r2
            WHERE r2."entityId" = rs."entityId"
            ORDER BY r2."scoredAt" DESC LIMIT 1
          )
        GROUP BY bucket
      `),

      // Overdue reviews
      prisma.thirdPartyReview.count({
        where: {
          entity: { masterOrgId: orgId },
          nextReviewDate: { lt: new Date() },
          status: { not: 'COMPLETED' },
        },
      }),

      // Pending workflow instances (replaces legacy onboarding instance count)
      prisma.workflowInstance.count({
        where: {
          orgId,
          status: { in: ['IN_PROGRESS', 'PAUSED'] },
          targetObjectType: 'ENTITY',
        },
      }),

      // Critical / high unresolved signals
      prisma.externalSignal.count({
        where: {
          orgId,
          severity:  { in: ['HIGH', 'CRITICAL'] },
          dismissed: false,
        },
      }),

      // Top 10 highest-risk entities
      prisma.$queryRaw<Array<{ entityId: string; name: string; riskScore: number; lastReviewDate: Date | null }>>(Prisma.sql`
        SELECT DISTINCT ON (rs."entityId")
          rs."entityId",
          e.name,
          rs."computedScore" AS "riskScore",
          tpr."lastReviewDate"
        FROM entity_risk_scores rs
        JOIN entities e ON e.id = rs."entityId"
        LEFT JOIN (
          SELECT "entityId", MAX("createdAt") AS "lastReviewDate"
          FROM third_party_reviews
          GROUP BY "entityId"
        ) tpr ON tpr."entityId" = rs."entityId"
        WHERE e."masterOrgId" = ${orgId}
        ORDER BY rs."entityId", rs."scoredAt" DESC, rs."computedScore" DESC
        LIMIT 10
      `),
    ])

  const bucket = (b: string) =>
    Number(riskCounts.find(r => r.bucket === b)?.cnt ?? 0)

  return {
    highRiskCount:     bucket('high'),
    mediumRiskCount:   bucket('medium'),
    lowRiskCount:      bucket('low'),
    overdueReviews,
    pendingOnboarding,
    criticalSignals,
    topRiskEntities,
  }
}

// ---------------------------------------------------------------------------
// Payment Queue
// ---------------------------------------------------------------------------

export interface PaymentQueueRow {
  currency:            string
  pendingApproval:     number
  amendmentPending:    number
  approvedAwaitingSend: number
  sentToErp:           number
  dueToday:            number
  overdue:             number
  totalPendingAmount:  number
}

export async function getPaymentQueueData(orgId: string): Promise<PaymentQueueRow[]> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1)

  const rows = await prisma.$queryRaw<
    Array<{
      currency:             string
      pendingApproval:      bigint
      amendmentPending:     bigint
      approvedAwaitingSend: bigint
      sentToErp:            bigint
      dueToday:             bigint
      overdue:              bigint
      totalPendingAmount:   number
    }>
  >(Prisma.sql`
    SELECT
      currency,
      COUNT(*) FILTER (WHERE status = 'PENDING_APPROVAL')               AS "pendingApproval",
      COUNT(*) FILTER (WHERE status = 'AMENDMENT_PENDING')              AS "amendmentPending",
      COUNT(*) FILTER (WHERE status = 'APPROVED')                       AS "approvedAwaitingSend",
      COUNT(*) FILTER (WHERE status = 'SENT_TO_ERP')                    AS "sentToErp",
      COUNT(*) FILTER (WHERE "dueDate" >= ${todayStart} AND "dueDate" < ${todayEnd}) AS "dueToday",
      COUNT(*) FILTER (WHERE "dueDate" < ${todayStart} AND status NOT IN ('CONFIRMED','CANCELLED','FAILED')) AS overdue,
      SUM(amount) FILTER (WHERE status NOT IN ('CONFIRMED','CANCELLED','FAILED')) AS "totalPendingAmount"
    FROM payment_instructions
    WHERE "orgId" = ${orgId}
    GROUP BY currency
    ORDER BY currency
  `)

  return rows.map(r => ({
    currency:             r.currency,
    pendingApproval:      Number(r.pendingApproval),
    amendmentPending:     Number(r.amendmentPending),
    approvedAwaitingSend: Number(r.approvedAwaitingSend),
    sentToErp:            Number(r.sentToErp),
    dueToday:             Number(r.dueToday),
    overdue:              Number(r.overdue),
    totalPendingAmount:   r.totalPendingAmount ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

export interface WorkloadRow {
  userId:                    string
  pendingApprovals:          number
  pendingAmendmentReviews:   number
  overdueReviews:            number
  totalWorkload:             number
}

export async function getWorkloadData(orgId: string): Promise<WorkloadRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      userId:                  string
      pendingApprovals:        bigint
      pendingAmendmentReviews: bigint
      overdueReviews:          bigint
    }>
  >(Prisma.sql`
    SELECT
      u.id AS "userId",
      COUNT(DISTINCT pa.id) FILTER (WHERE pa.status = 'PENDING') AS "pendingApprovals",
      COUNT(DISTINCT am.id) FILTER (WHERE am.status = 'PENDING') AS "pendingAmendmentReviews",
      COUNT(DISTINCT tpr.id) FILTER (
        WHERE tpr."nextReviewDate" < NOW() AND tpr.status != 'COMPLETED'
      ) AS "overdueReviews"
    FROM users u
    LEFT JOIN po_approvals pa
      ON pa."approverId" = u.id
    LEFT JOIN payment_instruction_amendments am
      ON am."requestedBy" != u.id   -- eligible to review (four-eyes)
    LEFT JOIN third_party_reviews tpr
      ON tpr."reviewedBy" = u.id
    WHERE u."orgId" = ${orgId}
    GROUP BY u.id
    HAVING
      COUNT(DISTINCT pa.id) FILTER (WHERE pa.status = 'PENDING') > 0
      OR COUNT(DISTINCT am.id) FILTER (WHERE am.status = 'PENDING') > 0
      OR COUNT(DISTINCT tpr.id) FILTER (
           WHERE tpr."nextReviewDate" < NOW() AND tpr.status != 'COMPLETED'
         ) > 0
    ORDER BY (
      COUNT(DISTINCT pa.id) FILTER (WHERE pa.status = 'PENDING') +
      COUNT(DISTINCT am.id) FILTER (WHERE am.status = 'PENDING') +
      COUNT(DISTINCT tpr.id) FILTER (
        WHERE tpr."nextReviewDate" < NOW() AND tpr.status != 'COMPLETED'
      )
    ) DESC
  `)

  return rows.map(r => {
    const pendingApprovals        = Number(r.pendingApprovals)
    const pendingAmendmentReviews = Number(r.pendingAmendmentReviews)
    const overdueReviews          = Number(r.overdueReviews)
    return {
      userId: r.userId,
      pendingApprovals,
      pendingAmendmentReviews,
      overdueReviews,
      totalWorkload: pendingApprovals + pendingAmendmentReviews + overdueReviews,
    }
  })
}
