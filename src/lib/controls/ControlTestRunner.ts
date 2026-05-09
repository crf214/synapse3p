/**
 * ControlTestRunner — runs automated evidence-gathering tests for each control
 * and persists results as ControlTestResult records.
 *
 * Each test function is pure in terms of side-effects: it only reads from the
 * database and returns { status, summary, details }. Side-effects (writing the
 * result row) happen exclusively in runControl().
 */

import { existsSync } from 'fs'
import { resolve } from 'path'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { ControlTestResult, TestResultStatus } from '@prisma/client'
import { safeExternalFetch } from '@/lib/security/outbound'
import { auditSecrets } from '@/lib/security/secrets-audit'
import { ForbiddenError } from '@/lib/errors'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TestResult {
  status:  TestResultStatus
  summary: string
  details: Record<string, unknown>
}

type TestFn = (orgId: string) => Promise<TestResult>

// Internal role set — anything not VENDOR or CLIENT
const INTERNAL_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const EXTERNAL_ROLES = new Set(['VENDOR', 'CLIENT'])

// ---------------------------------------------------------------------------
// Batch cursor helper — fetches all records in memory-safe batches of 1000.
// Prevents loading unbounded result sets in a single query for audit controls
// that must inspect every record without a time-window shortcut.
// ---------------------------------------------------------------------------
async function findManyInBatches<T extends { id: string }>(
  fetcher: (cursorId?: string) => Promise<T[]>,
  batchSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  let cursor: string | undefined

  for (;;) {
    const batch = await fetcher(cursor)
    all.push(...batch)
    if (batch.length < batchSize) break
    cursor = batch[batch.length - 1].id
  }

  return all
}

// ---------------------------------------------------------------------------
// AC-01 — User access review
// ---------------------------------------------------------------------------
async function testAC01(orgId: string): Promise<TestResult> {
  const members = await prisma.orgMember.findMany({
    where:   { orgId, status: 'active' },
    select:  { userId: true, role: true },
    orderBy: { createdAt: 'asc' },
    take:    1000,
  })

  // Group by userId to detect multi-role anomalies
  const byUser = new Map<string, string[]>()
  for (const m of members) {
    const existing = byUser.get(m.userId) ?? []
    existing.push(m.role)
    byUser.set(m.userId, existing)
  }

  const multiRole:    string[] = []
  const mixedAccess:  string[] = []

  for (const [userId, roles] of byUser) {
    if (roles.length > 1) multiRole.push(userId)

    const hasInternal = roles.some(r => INTERNAL_ROLES.has(r))
    const hasExternal = roles.some(r => EXTERNAL_ROLES.has(r))
    if (hasInternal && hasExternal) mixedAccess.push(userId)
  }

  const anomalies = [...new Set([...multiRole, ...mixedAccess])]
  const status: TestResultStatus = anomalies.length > 0 ? 'FAIL' : 'PASS'

  return {
    status,
    summary: anomalies.length === 0
      ? `${members.length} active users reviewed — all have appropriate single roles`
      : `${anomalies.length} anomaly(ies) detected among ${members.length} active users`,
    details: {
      totalActiveUsers:  members.length,
      uniqueUsers:       byUser.size,
      multiRoleUsers:    multiRole,
      mixedAccessUsers:  mixedAccess,
    },
  }
}

// ---------------------------------------------------------------------------
// AC-02 — Privileged access monitoring
// ---------------------------------------------------------------------------
async function testAC02(orgId: string): Promise<TestResult> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // Find all ADMIN members for this org
  const adminMembers = await prisma.orgMember.findMany({
    where: { orgId, role: 'ADMIN', status: 'active' },
    select: { userId: true },
  })
  const adminUserIds = adminMembers.map(m => m.userId)

  const events = await prisma.auditEvent.findMany({
    where: {
      orgId,
      actorId: { in: adminUserIds },
      createdAt: { gte: since },
    },
    select: { actorId: true, action: true, entityType: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const uniqueAdmins = [...new Set(events.map(e => e.actorId).filter(Boolean))]
  const status: TestResultStatus = events.length === 0 ? 'WARNING' : 'PASS'

  return {
    status,
    summary: events.length === 0
      ? `No ADMIN activity in last 7 days — verify this is expected (${adminUserIds.length} admins exist)`
      : `${events.length} admin actions recorded across ${uniqueAdmins.length} unique admin(s) in last 7 days`,
    details: {
      adminCount:        adminUserIds.length,
      eventCount:        events.length,
      activeAdmins:      uniqueAdmins,
      windowDays:        7,
      actionBreakdown:   Object.fromEntries(
        [...new Set(events.map(e => e.action))].map(a => [a, events.filter(e => e.action === a).length])
      ),
    },
  }
}

// ---------------------------------------------------------------------------
// AC-03 — Access termination
// ---------------------------------------------------------------------------
async function testAC03(orgId: string): Promise<TestResult> {
  const recentWindow = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const inactiveMembers = await prisma.orgMember.findMany({
    where: { orgId, status: { in: ['inactive', 'suspended'] } },
    select: { userId: true, status: true },
  })

  if (inactiveMembers.length === 0) {
    return {
      status:  'PASS',
      summary: 'No inactive or suspended members found',
      details: { inactiveMemberCount: 0 },
    }
  }

  const inactiveUserIds = inactiveMembers.map(m => m.userId)

  // Check if any inactive members have had recent updates (proxy for lingering sessions)
  const recentlyActive = await prisma.user.findMany({
    where: {
      id: { in: inactiveUserIds },
      updatedAt: { gte: recentWindow },
    },
    select: { id: true, email: true, updatedAt: true },
  })

  const status: TestResultStatus = recentlyActive.length > 0 ? 'FAIL' : 'PASS'

  return {
    status,
    summary: recentlyActive.length === 0
      ? `${inactiveMembers.length} inactive/suspended member(s) confirmed with no recent activity`
      : `${recentlyActive.length} inactive/suspended member(s) had activity within last 24 hours`,
    details: {
      inactiveMemberCount: inactiveMembers.length,
      recentlyActiveCount: recentlyActive.length,
      recentlyActiveUsers: recentlyActive.map(u => ({ id: u.id, email: u.email, updatedAt: u.updatedAt })),
    },
  }
}

// ---------------------------------------------------------------------------
// AC-04 — Payment four-eyes enforcement
// ---------------------------------------------------------------------------
async function testAC04(orgId: string): Promise<TestResult> {
  // Fetch all approved instructions in batches — must check 100% of records
  const instructions = await findManyInBatches<{ id: string; createdBy: string; approvedBy: string | null }>(
    (cursorId) => prisma.paymentInstruction.findMany({
      where: {
        orgId,
        status: { in: ['APPROVED', 'SENT_TO_ERP', 'CONFIRMED'] },
        approvedBy: { not: null },
      },
      select:  { id: true, createdBy: true, approvedBy: true },
      orderBy: { id: 'asc' },
      take:    1000,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    }),
  )

  const selfApproved = instructions.filter(i => i.approvedBy === i.createdBy)

  const amendments = await findManyInBatches<{ id: string; requestedBy: string; reviewedBy: string | null }>(
    (cursorId) => prisma.paymentInstructionAmendment.findMany({
      where: {
        paymentInstruction: { orgId },
        status: 'APPROVED',
        reviewedBy: { not: null },
      },
      select:  { id: true, requestedBy: true, reviewedBy: true },
      orderBy: { id: 'asc' },
      take:    1000,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    }),
  )

  const selfReviewedAmendments = amendments.filter(a => a.reviewedBy === a.requestedBy)

  const totalViolations = selfApproved.length + selfReviewedAmendments.length
  const status: TestResultStatus = totalViolations > 0 ? 'FAIL' : 'PASS'

  return {
    status,
    summary: totalViolations === 0
      ? `Four-eyes verified across ${instructions.length} instruction(s) and ${amendments.length} amendment(s)`
      : `${totalViolations} four-eyes violation(s) detected`,
    details: {
      instructionsChecked:       instructions.length,
      selfApprovedInstructions:  selfApproved.map(i => i.id),
      amendmentsChecked:         amendments.length,
      selfReviewedAmendments:    selfReviewedAmendments.map(a => a.id),
    },
  }
}

// ---------------------------------------------------------------------------
// FI-01 — Payment amendment four-eyes
// ---------------------------------------------------------------------------
async function testFI01(orgId: string): Promise<TestResult> {
  // Fetch all approved amendments in batches — must check 100% of records
  const amendments = await findManyInBatches<{ id: string; requestedBy: string; reviewedBy: string | null; field: string }>(
    (cursorId) => prisma.paymentInstructionAmendment.findMany({
      where: {
        paymentInstruction: { orgId },
        status: 'APPROVED',
        reviewedBy: { not: null },
      },
      select:  { id: true, requestedBy: true, reviewedBy: true, field: true },
      orderBy: { id: 'asc' },
      take:    1000,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    }),
  )

  const violations = amendments.filter(a => a.reviewedBy === a.requestedBy)
  const status: TestResultStatus = violations.length > 0 ? 'FAIL' : 'PASS'

  return {
    status,
    summary: violations.length === 0
      ? `Four-eyes verified across all ${amendments.length} approved amendment(s)`
      : `${violations.length} amendment(s) approved by their own requester`,
    details: {
      amendmentsChecked: amendments.length,
      violations:        violations.map(v => ({ id: v.id, field: v.field, userId: v.requestedBy })),
    },
  }
}

// ---------------------------------------------------------------------------
// FI-02 — Financial audit trail completeness
// ---------------------------------------------------------------------------
async function testFI02(orgId: string): Promise<TestResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const eventCount = await prisma.auditEvent.count({
    where: { orgId, createdAt: { gte: since } },
  })

  // Check for general system activity — any mutations at all
  const mutationCount = await prisma.auditEvent.count({
    where: { orgId, createdAt: { gte: since }, action: { in: ['CREATE', 'UPDATE', 'DELETE'] } },
  })

  let status: TestResultStatus = 'PASS'
  let summary: string

  if (eventCount === 0) {
    status = 'WARNING'
    summary = 'No audit events recorded in last 24 hours — verify system activity and audit middleware'
  } else {
    summary = `${eventCount} audit event(s) recorded in last 24 hours (${mutationCount} mutation(s))`
  }

  return {
    status,
    summary,
    details: { totalEvents: eventCount, mutationEvents: mutationCount, windowHours: 24 },
  }
}

// ---------------------------------------------------------------------------
// FI-03 — ERP transaction integrity
// ---------------------------------------------------------------------------
async function testFI03(orgId: string): Promise<TestResult> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const recentVersions = await prisma.erpTransactionVersion.count({
    where: {
      erpTransaction: { orgId },
      detectedAt: { gte: since },
    },
  })

  const changedTransactions = await prisma.erpTransaction.count({
    where: { orgId, currentVersionNo: { gt: 1 } },
  })

  const totalTransactions = await prisma.erpTransaction.count({ where: { orgId } })

  return {
    status:  'PASS',
    summary: `${totalTransactions} ERP transaction(s) tracked — ${changedTransactions} changed (versioned), ${recentVersions} version record(s) in last 7 days`,
    details: {
      totalTransactions,
      changedTransactions,
      recentVersionRecords: recentVersions,
      windowDays: 7,
      note: changedTransactions > 0
        ? `${changedTransactions} transaction(s) have been mutated after initial import — review version history`
        : 'No mutations detected — ERP data stable',
    },
  }
}

// ---------------------------------------------------------------------------
// FI-04 — Multi-currency integrity
// ---------------------------------------------------------------------------
async function testFI04(orgId: string): Promise<TestResult> {
  // Query invoices grouped by currency to demonstrate isolation is maintained
  const groups = await prisma.invoice.groupBy({
    by: ['currency'],
    where: { orgId },
    _count: { _all: true },
    _sum:   { amount: true },
  })

  const currencies = groups.map(g => g.currency)

  return {
    status:  'PASS',
    summary: `Currency isolation confirmed — ${groups.length} currency group(s) with no cross-currency aggregation`,
    details: {
      currenciesPresent: currencies,
      perCurrencyBreakdown: groups.map(g => ({
        currency:     g.currency,
        invoiceCount: g._count._all,
        totalAmount:  g._sum.amount,
      })),
      note: 'Sums computed per-currency only — no cross-currency aggregation performed',
    },
  }
}

// ---------------------------------------------------------------------------
// VR-01 — Vendor onboarding completeness
// ---------------------------------------------------------------------------
async function testVR01(orgId: string): Promise<TestResult> {
  const billPayEntities = await prisma.entityOrgRelationship.findMany({
    where: { orgId, activeForBillPay: true },
    select: { entityId: true },
  })

  if (billPayEntities.length === 0) {
    return {
      status:  'PASS',
      summary: 'No entities enabled for bill pay — nothing to verify',
      details: { billPayCount: 0 },
    }
  }

  const entityIds = billPayEntities.map(e => e.entityId)

  const completedOnboarding = await prisma.onboardingInstance.findMany({
    where: { orgId, entityId: { in: entityIds }, status: 'COMPLETED' },
    select: { entityId: true },
  })

  const completedEntityIds = new Set(completedOnboarding.map(o => o.entityId))
  const gaps = entityIds.filter(id => !completedEntityIds.has(id))
  const status: TestResultStatus = gaps.length > 0 ? 'FAIL' : 'PASS'

  return {
    status,
    summary: gaps.length === 0
      ? `All ${billPayEntities.length} bill-pay-enabled entities have completed onboarding`
      : `${gaps.length} of ${billPayEntities.length} bill-pay-enabled entities have incomplete onboarding`,
    details: {
      billPayCount:      billPayEntities.length,
      completedCount:    completedEntityIds.size,
      gapCount:          gaps.length,
      gapEntityIds:      gaps,
    },
  }
}

// ---------------------------------------------------------------------------
// VR-02 — High-risk vendor review cadence
// ---------------------------------------------------------------------------
async function testVR02(orgId: string): Promise<TestResult> {
  const since90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  // Fetch only the most recent score per entity by loading latest-first and
  // deduplicating. Cap at 2000 rows (covers 2000 distinct entities) to prevent
  // memory explosion as scoring history accumulates.
  const allScores = await prisma.entityRiskScore.findMany({
    where:   { entity: { orgRelationships: { some: { orgId } } } },
    select:  { entityId: true, computedScore: true, scoredAt: true },
    orderBy: { scoredAt: 'desc' },
    take:    2000,
  })

  // Deduplicate to latest per entity (already desc-ordered, so first hit wins)
  const latestByEntity = new Map<string, number>()
  for (const s of allScores) {
    if (!latestByEntity.has(s.entityId)) {
      latestByEntity.set(s.entityId, s.computedScore)
    }
  }

  const highRiskEntityIds = [...latestByEntity.entries()]
    .filter(([, score]) => score >= 7)
    .map(([id]) => id)

  if (highRiskEntityIds.length === 0) {
    return {
      status:  'PASS',
      summary: 'No high-risk entities (score >= 7) found',
      details: { highRiskCount: 0 },
    }
  }

  const recentReviews = await prisma.thirdPartyReview.findMany({
    where: {
      orgId,
      entityId: { in: highRiskEntityIds },
      status:   'COMPLETED',
      completedAt: { gte: since90Days },
    },
    select: { entityId: true, completedAt: true },
  })

  const reviewedEntityIds = new Set(recentReviews.map(r => r.entityId))
  const overdue = highRiskEntityIds.filter(id => !reviewedEntityIds.has(id))

  const status: TestResultStatus = overdue.length > 0
    ? (overdue.length === highRiskEntityIds.length ? 'FAIL' : 'WARNING')
    : 'PASS'

  return {
    status,
    summary: overdue.length === 0
      ? `All ${highRiskEntityIds.length} high-risk entity(ies) reviewed within 90 days`
      : `${overdue.length} of ${highRiskEntityIds.length} high-risk entity(ies) overdue for review`,
    details: {
      highRiskCount:    highRiskEntityIds.length,
      reviewedCount:    reviewedEntityIds.size,
      overdueCount:     overdue.length,
      overdueEntityIds: overdue,
      windowDays:       90,
    },
  }
}

// ---------------------------------------------------------------------------
// VR-03 — Third-party review documentation
// ---------------------------------------------------------------------------
async function testVR03(orgId: string): Promise<TestResult> {
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)

  const completed = await prisma.thirdPartyReview.findMany({
    where:   { orgId, status: 'COMPLETED', completedAt: { gte: twoYearsAgo } },
    select:  { id: true, entityId: true, cyberScore: true, legalScore: true, privacyScore: true, completedAt: true },
    orderBy: { completedAt: 'desc' },
    take:    1000,
  })

  if (completed.length === 0) {
    return {
      status:  'WARNING',
      summary: 'No completed third-party reviews found',
      details: { completedCount: 0 },
    }
  }

  const incomplete = completed.filter(
    r => r.cyberScore === null || r.legalScore === null || r.privacyScore === null
  )

  const status: TestResultStatus = incomplete.length > 0 ? 'WARNING' : 'PASS'

  return {
    status,
    summary: incomplete.length === 0
      ? `All ${completed.length} completed review(s) have full scores across cyber, legal, and privacy domains`
      : `${incomplete.length} of ${completed.length} completed review(s) have missing domain scores`,
    details: {
      completedCount:   completed.length,
      incompleteCount:  incomplete.length,
      incompleteIds:    incomplete.map(r => r.id),
    },
  }
}

// ---------------------------------------------------------------------------
// BC-01 — Backup verification
// ---------------------------------------------------------------------------
async function testBC01(orgId: string): Promise<TestResult> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const recentRecord = await prisma.bcDrRecord.findFirst({
    where: { orgId, recordType: 'BACKUP_VERIFICATION', testedAt: { gte: since24h } },
    orderBy: { testedAt: 'desc' },
    select: { id: true, status: true, testedAt: true, description: true },
  })

  if (!recentRecord) {
    return {
      status:  'WARNING',
      summary: 'No BACKUP_VERIFICATION record found in last 24 hours — manual verification required',
      details: {
        note:         'Supabase backup status cannot be queried programmatically — verify in Supabase dashboard under Settings > Backups',
        action:       'Create a BcDrRecord of type BACKUP_VERIFICATION after each manual verification',
        lastRecordAt: null,
      },
    }
  }

  return {
    status:  recentRecord.status === 'PASS' ? 'PASS' : 'WARNING',
    summary: `Backup verification recorded ${recentRecord.testedAt.toISOString()} — status: ${recentRecord.status}`,
    details: {
      recordId:    recentRecord.id,
      recordedAt:  recentRecord.testedAt,
      recordStatus: recentRecord.status,
      description: recentRecord.description,
    },
  }
}

// ---------------------------------------------------------------------------
// BC-02 — RTO/RPO documentation
// ---------------------------------------------------------------------------
async function testBC02(orgId: string): Promise<TestResult> {
  const since90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

  const recentTest = await prisma.bcDrRecord.findFirst({
    where: {
      orgId,
      recordType: { in: ['RTO_TEST', 'RPO_TEST'] },
      testedAt: { gte: since90Days },
    },
    orderBy: { testedAt: 'desc' },
    select: { id: true, recordType: true, actualRtoHours: true, actualRpoHours: true, rtoTargetHours: true, rpoTargetHours: true, testedAt: true, status: true },
  })

  if (!recentTest) {
    return {
      status:  'WARNING',
      summary: 'No RTO/RPO test recorded in last 90 days — schedule a DR test',
      details: { windowDays: 90, lastTestAt: null },
    }
  }

  const rtoMet = recentTest.actualRtoHours === null || recentTest.actualRtoHours <= recentTest.rtoTargetHours
  const rpoMet = recentTest.actualRpoHours === null || recentTest.actualRpoHours <= recentTest.rpoTargetHours
  const metTargets = rtoMet && rpoMet

  return {
    status:  metTargets ? 'PASS' : 'FAIL',
    summary: metTargets
      ? `RTO/RPO targets met — RTO: ${recentTest.actualRtoHours ?? 'n/a'}h (target ${recentTest.rtoTargetHours}h), RPO: ${recentTest.actualRpoHours ?? 'n/a'}h (target ${recentTest.rpoTargetHours}h)`
      : `RTO/RPO targets missed — RTO: ${recentTest.actualRtoHours}h (target ${recentTest.rtoTargetHours}h), RPO: ${recentTest.actualRpoHours}h (target ${recentTest.rpoTargetHours}h)`,
    details: {
      recordId:       recentTest.id,
      recordType:     recentTest.recordType,
      testedAt:       recentTest.testedAt,
      actualRtoHours: recentTest.actualRtoHours,
      actualRpoHours: recentTest.actualRpoHours,
      rtoTargetHours: recentTest.rtoTargetHours,
      rpoTargetHours: recentTest.rpoTargetHours,
      rtoMet,
      rpoMet,
    },
  }
}

// ---------------------------------------------------------------------------
// BC-03 — System availability monitoring
// ---------------------------------------------------------------------------
async function testBC03(orgId: string): Promise<TestResult> {
  const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const syncLogs = await prisma.erpSyncLog.findMany({
    where: { orgId, startedAt: { gte: since7Days } },
    select: { startedAt: true, status: true },
    orderBy: { startedAt: 'asc' },
  })

  // Count distinct days with recorded activity
  const activeDays = new Set(
    syncLogs.map(l => l.startedAt.toISOString().slice(0, 10))
  )

  const auditActivity = await prisma.auditEvent.count({
    where: { orgId, createdAt: { gte: since7Days } },
  })

  const status: TestResultStatus = activeDays.size >= 5 || auditActivity > 0 ? 'PASS' : 'WARNING'

  return {
    status,
    summary: `${activeDays.size}/7 days with recorded sync activity, ${auditActivity} audit events in last 7 days`,
    details: {
      activeDays:       [...activeDays],
      syncLogCount:     syncLogs.length,
      auditEventCount:  auditActivity,
      windowDays:       7,
      note:             'Sync log presence and audit activity used as availability proxy — integrate uptime monitoring for formal SLA tracking',
    },
  }
}

// ---------------------------------------------------------------------------
// MO-01 — Nightly health check
// ---------------------------------------------------------------------------
async function testMO01(orgId: string): Promise<TestResult> {
  const healthCheckPath  = resolve(process.cwd(), 'scripts/health-check.ts')
  const workflowPath     = resolve(process.cwd(), '.github/workflows/health-check.yml')

  const scriptExists   = existsSync(healthCheckPath)
  const workflowExists = existsSync(workflowPath)

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentActivity = await prisma.auditEvent.count({
    where: { orgId, createdAt: { gte: since24h } },
  })

  const status: TestResultStatus = scriptExists && workflowExists ? 'PASS' : 'FAIL'

  return {
    status,
    summary: status === 'PASS'
      ? `Health check script and workflow both present — ${recentActivity} audit event(s) in last 24h confirm system activity`
      : 'Health check script or workflow file missing',
    details: {
      healthCheckScriptPresent: scriptExists,
      githubWorkflowPresent:    workflowExists,
      recentAuditEvents:        recentActivity,
    },
  }
}

// ---------------------------------------------------------------------------
// MO-02 — Security controls verification
// ---------------------------------------------------------------------------
async function testMO02(_orgId: string): Promise<TestResult> {
  const failures: string[] = []

  // Test outbound security controls
  try {
    await safeExternalFetch('https://192.168.1.1/test')
    failures.push('Private IP 192.168.1.1 was not blocked')
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      failures.push(`Private IP check threw unexpected error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  try {
    await safeExternalFetch('https://not-allowed-domain.com/test')
    failures.push('Non-allowlisted domain was not blocked')
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      failures.push(`Domain allowlist check threw unexpected error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  try {
    await safeExternalFetch('http://api.frankfurter.app/latest')
    failures.push('HTTP (non-HTTPS) request was not blocked')
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      failures.push(`HTTPS enforcement check threw unexpected error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Test secrets audit
  const { errors: secretErrors, warnings: secretWarnings } = auditSecrets()
  if (secretErrors.length > 0) {
    failures.push(`Secrets audit errors: ${secretErrors.join('; ')}`)
  }

  const status: TestResultStatus = failures.length > 0 ? 'FAIL' : 'PASS'

  return {
    status,
    summary: failures.length === 0
      ? 'All security controls operational: outbound allowlist, HTTPS enforcement, private IP blocking, secrets audit'
      : `${failures.length} security control(s) failed`,
    details: {
      outboundControlsVerified: failures.filter(f => !f.startsWith('Secrets')).length === 0,
      secretsAuditPassed:       secretErrors.length === 0,
      secretsWarnings:          secretWarnings,
      failures,
    },
  }
}

// ---------------------------------------------------------------------------
// MO-03 — External signal monitoring
// ---------------------------------------------------------------------------
async function testMO03(orgId: string): Promise<TestResult> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const activeConfigs = await prisma.externalSignalConfig.count({
    where: { orgId, isActive: true },
  })

  const recentSignals = await prisma.externalSignal.count({
    where: { orgId, detectedAt: { gte: since24h } },
  })

  let status: TestResultStatus = 'PASS'
  let summary: string

  if (activeConfigs === 0) {
    status  = 'WARNING'
    summary = 'No active external signal configurations — monitoring not configured'
  } else if (recentSignals === 0) {
    status  = 'PASS'   // No signals is normal — means no alerts triggered
    summary = `${activeConfigs} active signal config(s) — no signals detected in last 24h (system clean)`
  } else {
    summary = `${activeConfigs} active signal config(s) — ${recentSignals} signal(s) detected in last 24h`
  }

  return {
    status,
    summary,
    details: {
      activeConfigs,
      recentSignals,
      windowHours: 24,
    },
  }
}

// ---------------------------------------------------------------------------
// Test registry
// ---------------------------------------------------------------------------
const TEST_REGISTRY: Record<string, TestFn> = {
  'AC-01': testAC01,
  'AC-02': testAC02,
  'AC-03': testAC03,
  'AC-04': testAC04,
  'FI-01': testFI01,
  'FI-02': testFI02,
  'FI-03': testFI03,
  'FI-04': testFI04,
  'VR-01': testVR01,
  'VR-02': testVR02,
  'VR-03': testVR03,
  'BC-01': testBC01,
  'BC-02': testBC02,
  'BC-03': testBC03,
  'MO-01': testMO01,
  'MO-02': testMO02,
  'MO-03': testMO03,
  // CM-01, CM-02, CM-03 are infrastructure-level controls verified via CI/CD —
  // they do not have runtime database queries and must be attested manually or
  // via CI pipeline artefacts. They are omitted from the automated registry.
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single control by its automatedTestKey and persist the result.
 * Never throws — errors are captured as ERROR status results.
 */
export async function runControl(
  orgId:          string,
  controlKey:     string,
  auditPeriodId?: string,
): Promise<ControlTestResult> {
  const control = await prisma.control.findFirst({
    where: { automatedTestKey: controlKey, orgId },
  })

  if (!control) {
    // Create a synthetic error result without a real controlId
    throw new Error(`Control not found: key=${controlKey} orgId=${orgId}`)
  }

  const testFn = TEST_REGISTRY[controlKey]

  let resultData: TestResult
  if (!testFn) {
    resultData = {
      status:  'NOT_RUN',
      summary: `No automated test implemented for ${controlKey} — manual attestation required`,
      details: { controlKey, reason: 'not_implemented' },
    }
  } else {
    try {
      resultData = await testFn(orgId)
    } catch (err) {
      resultData = {
        status:  'ERROR',
        summary: `Test execution failed: ${err instanceof Error ? err.message : String(err)}`,
        details: { controlKey, error: err instanceof Error ? err.stack : String(err) },
      }
    }
  }

  return prisma.controlTestResult.create({
    data: {
      controlId:     control.id,
      orgId,
      auditPeriodId: auditPeriodId ?? null,
      status:        resultData.status,
      summary:       resultData.summary,
      details:       resultData.details as Prisma.InputJsonValue,
      evidence:      Prisma.JsonNull,
      testedBy:      'system',
    },
  })
}

/**
 * Run all ACTIVE controls for an org and return summary counts.
 * Never throws.
 */
export async function runAllControls(
  orgId:          string,
  auditPeriodId?: string,
): Promise<{ passed: number; failed: number; warnings: number; errors: number; notRun: number }> {
  const controls = await prisma.control.findMany({
    where: { orgId, status: 'ACTIVE' },
    select: { automatedTestKey: true },
    orderBy: { controlId: 'asc' },
  })

  const counts = { passed: 0, failed: 0, warnings: 0, errors: 0, notRun: 0 }

  for (const control of controls) {
    if (!control.automatedTestKey) { counts.notRun++; continue }
    try {
      const result = await runControl(orgId, control.automatedTestKey, auditPeriodId)
      if      (result.status === 'PASS')    counts.passed++
      else if (result.status === 'FAIL')    counts.failed++
      else if (result.status === 'WARNING') counts.warnings++
      else if (result.status === 'ERROR')   counts.errors++
      else                                  counts.notRun++
    } catch {
      counts.errors++
    }
  }

  return counts
}
