// src/lib/invoice-pipeline.ts
// Core invoice processing pipeline. Called after an invoice is created from
// any ingestion channel (email webhook or file upload).
//
// Sequence:
//   extractFromPdf/Text → post-extraction duplicate check →
//   recurring schedule match → contract match →
//   risk scoring → decision routing
//
// Note: AutoApprovePolicy removed in Phase 3A. Auto-approve logic is now
//       configured via workflow engine templates (AUTO_RULE steps).
//       For now, all non-duplicate invoices are routed to PENDING_REVIEW.

import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { extractFromPdf, extractFromText, persistExtractionFields } from '@/lib/invoice-ai'
import { sendInvoiceReminderEmail } from '@/lib/resend'
import { scoreToBand } from '@/lib/risk/compute-risk-band'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RiskSignalType =
  | 'NEW_VENDOR'
  | 'AMOUNT_VARIANCE'
  | 'NO_CONTRACT_MATCH'
  | 'CONTRACT_EXPIRED'
  | 'CONTRACT_EXPIRING_SOON'
  | 'DUPLICATE_FLAG'
  | 'MISSING_FIELDS'
  | 'UNCONTRACTED_SPEND'
  | 'AMOUNT_OVER_THRESHOLD'
  | 'FREQUENCY_ANOMALY'
  | 'SANCTION_FLAG'

interface Signal {
  type:      RiskSignalType
  triggered: boolean
  value?:    number
  detail?:   string
}

// ---------------------------------------------------------------------------
// Tier thresholds and signal weights
// ---------------------------------------------------------------------------

const HIGH_SIGNALS  = new Set<RiskSignalType>(['DUPLICATE_FLAG', 'CONTRACT_EXPIRED', 'SANCTION_FLAG'])
const MEDIUM_SIGNALS = new Set<RiskSignalType>([
  'AMOUNT_VARIANCE', 'NO_CONTRACT_MATCH', 'MISSING_FIELDS',
  'UNCONTRACTED_SPEND', 'AMOUNT_OVER_THRESHOLD', 'FREQUENCY_ANOMALY', 'CONTRACT_EXPIRING_SOON',
])

const WEIGHTS: Record<RiskSignalType, number> = {
  DUPLICATE_FLAG:         3.0,
  CONTRACT_EXPIRED:       3.0,
  SANCTION_FLAG:          3.0,
  AMOUNT_VARIANCE:        1.5,
  NO_CONTRACT_MATCH:      1.5,
  MISSING_FIELDS:         1.0,
  UNCONTRACTED_SPEND:     1.5,
  AMOUNT_OVER_THRESHOLD:  1.5,
  FREQUENCY_ANOMALY:      1.5,
  CONTRACT_EXPIRING_SOON: 1.0,
  NEW_VENDOR:             0.5,
}

// ---------------------------------------------------------------------------
// Pre-extraction duplicate check (email message ID + PDF fingerprint)
// Returns the invoiceId of the existing duplicate, or null if clean.
// ---------------------------------------------------------------------------

export async function checkPreExtractionDuplicates(opts: {
  orgId:          string
  emailMessageId: string | null
  pdfFingerprint: string | null
}): Promise<string | null> {
  const { orgId, emailMessageId, pdfFingerprint } = opts

  if (emailMessageId) {
    const existing = await prisma.invoice.findFirst({
      where: { orgId, emailMessageId, status: { not: 'DUPLICATE' } },
      select: { id: true },
    })
    if (existing) return existing.id
  }

  if (pdfFingerprint) {
    const existing = await prisma.invoice.findFirst({
      where: { orgId, pdfFingerprint, status: { not: 'DUPLICATE' } },
      select: { id: true },
    })
    if (existing) return existing.id
  }

  return null
}

// ---------------------------------------------------------------------------
// Quarantine an invoice as a duplicate
// ---------------------------------------------------------------------------

export async function quarantineAsDuplicate(opts: {
  orgId:               string
  invoiceId:           string
  duplicateOfInvoiceId: string | null
  signals: {
    matchedOnEmailMsgId:   boolean
    matchedOnPdfHash:      boolean
    matchedOnInvoiceNo:    boolean
    matchedOnVendorAmount: boolean
  }
  signalDetails?: Prisma.JsonObject
}): Promise<void> {
  const { orgId, invoiceId, duplicateOfInvoiceId, signals, signalDetails } = opts

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoiceId },
      data:  { status: 'DUPLICATE' },
    }),
    prisma.invoiceDuplicateFlag.create({
      data: {
        orgId,
        invoiceId,
        duplicateOfInvoiceId,
        matchedOnEmailMsgId:   signals.matchedOnEmailMsgId,
        matchedOnPdfHash:      signals.matchedOnPdfHash,
        matchedOnInvoiceNo:    signals.matchedOnInvoiceNo,
        matchedOnVendorAmount: signals.matchedOnVendorAmount,
        signalDetails: signalDetails ?? {},
        status:    'QUARANTINED',
        detectedBy: 'system',
      },
    }),
  ])
}

// ---------------------------------------------------------------------------
// SHA-256 fingerprint of raw bytes
// ---------------------------------------------------------------------------

export function computeFingerprint(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// ---------------------------------------------------------------------------
// Main pipeline — run after invoice is created
// ---------------------------------------------------------------------------

export async function runInvoicePipeline(opts: {
  invoiceId:   string
  orgId:       string
  pdfBase64?:  string    // if from PDF ingestion
  emailText?:  string    // if from email body
}): Promise<void> {
  const { invoiceId, orgId, pdfBase64, emailText } = opts

  try {
    // -----------------------------------------------------------------------
    // 1. AI Extraction
    // -----------------------------------------------------------------------
    let extractionResult
    if (pdfBase64) {
      extractionResult = await extractFromPdf(pdfBase64)
    } else if (emailText) {
      extractionResult = await extractFromText(emailText)
    }

    if (extractionResult) {
      await persistExtractionFields(invoiceId, extractionResult)
    }

    // -----------------------------------------------------------------------
    // 2. Post-extraction duplicate check (invoiceNo + entityId, vendor + amount + date)
    // -----------------------------------------------------------------------
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        entity: {
          include: {
            dueDiligence: true,
            financial:    true,
          },
        },
        extractedFields: true,
      },
    })

    if (invoice.status === 'DUPLICATE') return  // already quarantined by pre-check

    // Check invoiceNo + entityId uniqueness
    if (invoice.invoiceNo) {
      const sameInvoiceNo = await prisma.invoice.findFirst({
        where: {
          orgId,
          invoiceNo: invoice.invoiceNo,
          entityId:  invoice.entityId,
          id:        { not: invoiceId },
          status:    { not: 'DUPLICATE' },
        },
        select: { id: true },
      })

      if (sameInvoiceNo) {
        await quarantineAsDuplicate({
          orgId,
          invoiceId,
          duplicateOfInvoiceId: sameInvoiceNo.id,
          signals: { matchedOnInvoiceNo: true, matchedOnPdfHash: false, matchedOnEmailMsgId: false, matchedOnVendorAmount: false },
          signalDetails: { existingInvoiceId: sameInvoiceNo.id, invoiceNo: invoice.invoiceNo },
        })
        return
      }
    }

    // Check vendor + amount + date proximity (7-day window)
    const DATE_WINDOW_DAYS = 7
    const windowStart = new Date(invoice.invoiceDate)
    windowStart.setDate(windowStart.getDate() - DATE_WINDOW_DAYS)
    const windowEnd = new Date(invoice.invoiceDate)
    windowEnd.setDate(windowEnd.getDate() + DATE_WINDOW_DAYS)

    const sameVendorAmount = await prisma.invoice.findFirst({
      where: {
        orgId,
        entityId:    invoice.entityId,
        amount:      invoice.amount,
        invoiceDate: { gte: windowStart, lte: windowEnd },
        id:          { not: invoiceId },
        status:      { not: 'DUPLICATE' },
      },
      select: { id: true },
    })

    if (sameVendorAmount) {
      await quarantineAsDuplicate({
        orgId,
        invoiceId,
        duplicateOfInvoiceId: sameVendorAmount.id,
        signals: { matchedOnVendorAmount: true, matchedOnInvoiceNo: false, matchedOnPdfHash: false, matchedOnEmailMsgId: false },
        signalDetails: { existingInvoiceId: sameVendorAmount.id, amount: invoice.amount, windowDays: DATE_WINDOW_DAYS },
      })
      return
    }

    // -----------------------------------------------------------------------
    // 3. Recurring schedule match
    // -----------------------------------------------------------------------
    await matchRecurringSchedule(invoiceId, orgId, invoice.entityId, invoice.amount)

    // -----------------------------------------------------------------------
    // 4. Contract match (find active contract for entity if not set)
    // -----------------------------------------------------------------------
    if (!invoice.contractId) {
      await matchContract(invoiceId, orgId, invoice.entityId)
    }

    // -----------------------------------------------------------------------
    // 5. Risk scoring
    // -----------------------------------------------------------------------
    // Re-fetch with all relations populated after updates above
    const invoiceForRisk = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        contract:        true,
        extractedFields: true,
        duplicateFlags:  { where: { status: { in: ['QUARANTINED', 'OVERRIDE_APPROVED'] } } },
      },
    })

    const signals = await buildRiskSignals(invoiceForRisk, orgId)
    const { evaluation, tier } = scoreRisk(signals, invoice.amount)

    const riskEval = await prisma.riskEvaluation.create({
      data: {
        invoiceId,
        orgId,
        overallScore:      evaluation.overallScore,
        tier,
        amountScore:       evaluation.amountScore,
        frequencyScore:    evaluation.frequencyScore,
        vendorScore:       evaluation.vendorScore,
        duplicateScore:    evaluation.duplicateScore,
        toleranceScore:    evaluation.toleranceScore,
        weights:           WEIGHTS,
        flags:             signals.filter(s => s.triggered).map(s => s.type),
        explanation:       signals as unknown as Prisma.InputJsonValue,
        withinTolerance:   !signals.find(s => s.type === 'AMOUNT_VARIANCE' && s.triggered),
        deviation:         evaluation.deviation,
        deviationPct:      evaluation.deviationPct,
        effectiveTolerance: evaluation.effectiveTolerance,
      },
    })

    await prisma.riskSignal.createMany({
      data: signals.map(s => ({
        riskEvaluationId: riskEval.id,
        signalType:        s.type,
        triggered:         s.triggered,
        value:             s.value ?? null,
        weight:            WEIGHTS[s.type],
        detail:            s.detail ?? null,
      })),
    })

    // Stamp the invoice with its risk band derived from the overall score
    const invoiceRiskBand = scoreToBand(evaluation.overallScore * 10) // overallScore is 0–10, scoreToBand expects 0–100
    await prisma.invoice.update({
      where: { id: invoiceId },
      data:  { riskBand: invoiceRiskBand },
    })

    // -----------------------------------------------------------------------
    // 6. Decision routing (auto-approve policies replaced by workflow engine)
    // -----------------------------------------------------------------------
    await routeInvoiceDecision(invoiceId, orgId, signals, tier, invoice.amount)
  } catch (err) {
    console.error(`[invoice-pipeline] error processing invoice ${invoiceId}:`, err)
    // Mark invoice as needing human review
    await prisma.invoice.update({
      where: { id: invoiceId },
      data:  { status: 'PENDING_REVIEW' },
    }).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Recurring schedule matching
// ---------------------------------------------------------------------------

async function matchRecurringSchedule(
  invoiceId: string,
  orgId:     string,
  entityId:  string,
  amount:    number,
): Promise<void> {
  const schedules = await prisma.recurringSchedule.findMany({
    where: { orgId, entityId, isActive: true },
  })

  for (const sched of schedules) {
    const pct      = sched.tolerancePct
    const fixed    = sched.toleranceFixed
    const expected = sched.expectedAmount

    const withinPct   = Math.abs(amount - expected) / expected <= pct
    const withinFixed = Math.abs(amount - expected) <= fixed

    if (withinPct || withinFixed) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data:  { isRecurring: true, recurringScheduleId: sched.id },
      })

      await prisma.recurringSchedule.update({
        where: { id: sched.id },
        data:  { lastInvoiceAt: new Date(), lastInvoiceAmount: amount, invoiceCount: { increment: 1 } },
      })
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Contract matching (best-effort)
// ---------------------------------------------------------------------------

async function matchContract(
  invoiceId: string,
  orgId:     string,
  entityId:  string,
): Promise<void> {
  const activeContracts = await prisma.contract.findMany({
    where: { orgId, entityId, status: 'ACTIVE' },
    orderBy: { endDate: 'asc' },
  })

  if (activeContracts.length === 1) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data:  { contractId: activeContracts[0].id, contractMatchConf: 0.8 },
    })
  }
  // Multiple contracts: leave unmatched (requires human selection in review)
}

// ---------------------------------------------------------------------------
// Risk signal evaluation
// ---------------------------------------------------------------------------

async function buildRiskSignals(
  invoice: Awaited<ReturnType<typeof prisma.invoice.findUniqueOrThrow>> & {
    contract?:        { status: string; endDate: Date | null } | null
    extractedFields?: Array<{ needsReview: boolean }>
    duplicateFlags?:  Array<{ status: string }>
  },
  orgId: string,
): Promise<Signal[]> {
  const signals: Signal[] = []
  const now = new Date()
  const thirtyDaysOut = new Date(now); thirtyDaysOut.setDate(now.getDate() + 30)

  // NEW_VENDOR / AMOUNT_VARIANCE: direct query against invoices for last 6 months
  // VendorSpendSnapshot replaced with direct query — snapshot table retained but no longer read
  type SpendRow = { period: string; totalAmount: string; invoiceCount: bigint }
  const spendRows = await prisma.$queryRaw<SpendRow[]>`
    SELECT
      TO_CHAR(DATE_TRUNC('month', "invoiceDate"), 'YYYY-MM') AS period,
      SUM(amount)::text                                        AS "totalAmount",
      COUNT(*)                                                 AS "invoiceCount"
    FROM invoices
    WHERE "orgId"       = ${orgId}
      AND "entityId"    = ${invoice.entityId}
      AND "invoiceDate" >= NOW() - INTERVAL '6 months'
      AND status        != 'DUPLICATE'
    GROUP BY DATE_TRUNC('month', "invoiceDate")
    ORDER BY DATE_TRUNC('month', "invoiceDate") ASC
  `
  const isNewVendor = spendRows.length === 0
  signals.push({
    type:      'NEW_VENDOR',
    triggered: isNewVendor,
    detail:    isNewVendor ? 'No spend history in the last 6 months' : undefined,
  })

  // AMOUNT_VARIANCE: >10% vs 6-month average
  let avgAmount    = 0
  let deviation    = 0
  let deviationPct = 0
  if (spendRows.length > 0) {
    const totalInvoices = spendRows.reduce((acc, s) => acc + Number(s.invoiceCount), 0)
    const totalAmount   = spendRows.reduce((acc, s) => acc + parseFloat(s.totalAmount), 0)
    avgAmount   = totalInvoices > 0 ? totalAmount / totalInvoices : 0
    deviation   = Math.abs(invoice.amount - avgAmount)
    deviationPct = avgAmount > 0 ? deviation / avgAmount : 0
    const varianceTriggered = avgAmount > 0 && deviationPct > 0.10
    signals.push({
      type:      'AMOUNT_VARIANCE',
      triggered: varianceTriggered,
      value:     deviationPct,
      detail:    varianceTriggered
        ? `Invoice amount ${invoice.amount} deviates ${(deviationPct * 100).toFixed(1)}% from 6-month average ${avgAmount.toFixed(2)}`
        : undefined,
    })
  } else {
    signals.push({ type: 'AMOUNT_VARIANCE', triggered: false })
  }

  // CONTRACT_EXPIRED / CONTRACT_EXPIRING_SOON / NO_CONTRACT_MATCH
  if (invoice.contractId && invoice.contract) {
    const expired = invoice.contract.status === 'EXPIRED' ||
      (invoice.contract.endDate !== null && invoice.contract.endDate < now)
    const expiringSoon = !expired &&
      invoice.contract.endDate !== null &&
      invoice.contract.endDate < thirtyDaysOut

    signals.push({ type: 'CONTRACT_EXPIRED',       triggered: expired,      detail: expired ? 'Contract is expired' : undefined })
    signals.push({ type: 'CONTRACT_EXPIRING_SOON', triggered: expiringSoon, value: invoice.contract.endDate ? Math.ceil((invoice.contract.endDate.getTime() - now.getTime()) / 86400000) : undefined, detail: expiringSoon ? `Contract expires within 30 days` : undefined })
    signals.push({ type: 'NO_CONTRACT_MATCH',      triggered: false })
  } else {
    signals.push({ type: 'CONTRACT_EXPIRED',       triggered: false })
    signals.push({ type: 'CONTRACT_EXPIRING_SOON', triggered: false })
    signals.push({ type: 'NO_CONTRACT_MATCH',      triggered: true, detail: 'No active contract linked' })
  }

  // DUPLICATE_FLAG: has an overridden duplicate flag (means it passed through despite being suspected)
  const hasOverriddenDuplicate = (invoice.duplicateFlags ?? []).some(f => f.status === 'OVERRIDE_APPROVED')
  signals.push({
    type:      'DUPLICATE_FLAG',
    triggered: hasOverriddenDuplicate,
    detail:    hasOverriddenDuplicate ? 'Duplicate flag was overridden — elevated risk' : undefined,
  })

  // MISSING_FIELDS
  const missingFields = (invoice.extractedFields ?? []).filter(f => f.needsReview)
  signals.push({
    type:      'MISSING_FIELDS',
    triggered: missingFields.length > 0,
    value:     missingFields.length,
    detail:    missingFields.length > 0 ? `${missingFields.length} field(s) require human review (low confidence)` : undefined,
  })

  // UNCONTRACTED_SPEND: no PO and no contract
  const isUncontracted = !invoice.poId && !invoice.contractId
  signals.push({
    type:      'UNCONTRACTED_SPEND',
    triggered: isUncontracted,
    detail:    isUncontracted ? 'No purchase order or contract linked' : undefined,
  })

  // AMOUNT_OVER_THRESHOLD: legacy policy check removed in Phase 3A.
  // Threshold rules are now configured as AUTO_RULE steps in workflow templates.
  signals.push({ type: 'AMOUNT_OVER_THRESHOLD', triggered: false })

  // FREQUENCY_ANOMALY: invoice arrived outside expected window for recurring schedule
  if (invoice.recurringScheduleId) {
    const sched = await prisma.recurringSchedule.findUnique({
      where: { id: invoice.recurringScheduleId },
    })
    if (sched?.lastInvoiceAt) {
      // Simple frequency check based on declared frequency string
      const daysSinceLast = Math.abs(
        (new Date().getTime() - sched.lastInvoiceAt.getTime()) / 86400000,
      )
      const expectedDays = frequencyToDays(sched.frequency)
      const anomalyTriggered = expectedDays > 0 && Math.abs(daysSinceLast - expectedDays) > expectedDays * 0.25
      signals.push({
        type:      'FREQUENCY_ANOMALY',
        triggered: anomalyTriggered,
        value:     daysSinceLast,
        detail:    anomalyTriggered
          ? `Expected every ${expectedDays}d, arrived ${Math.round(daysSinceLast)}d since last`
          : undefined,
      })
    } else {
      signals.push({ type: 'FREQUENCY_ANOMALY', triggered: false })
    }
  } else {
    signals.push({ type: 'FREQUENCY_ANOMALY', triggered: false })
  }

  // SANCTION_FLAG: entity has sanction status flagged/blocked
  const entity = await prisma.entity.findUnique({
    where: { id: invoice.entityId },
    include: { dueDiligence: true },
  })
  const sanctioned = entity?.dueDiligence?.sanctionsStatus === 'FLAGGED' ||
    entity?.dueDiligence?.sanctionsStatus === 'BLOCKED'
  signals.push({
    type:      'SANCTION_FLAG',
    triggered: sanctioned,
    detail:    sanctioned ? `Entity sanctions status: ${entity?.dueDiligence?.sanctionsStatus}` : undefined,
  })

  return signals
}

function frequencyToDays(frequency: string): number {
  const map: Record<string, number> = {
    DAILY: 1, WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 30, QUARTERLY: 90, ANNUAL: 365,
  }
  return map[frequency.toUpperCase()] ?? 0
}

// ---------------------------------------------------------------------------
// Score and tier assignment
// ---------------------------------------------------------------------------

function scoreRisk(
  signals:  Signal[],
  amount:   number,
): {
  evaluation: {
    overallScore: number; amountScore: number; frequencyScore: number
    vendorScore: number; duplicateScore: number; toleranceScore: number
    deviation: number; deviationPct: number; effectiveTolerance: number
  }
  tier: 'LOW' | 'MEDIUM' | 'HIGH'
} {
  const triggered = signals.filter(s => s.triggered)
  const overallScore = Math.min(10, triggered.reduce((sum, s) => sum + (WEIGHTS[s.type] ?? 0), 0))

  const hasHigh   = triggered.some(s => HIGH_SIGNALS.has(s.type))
  const hasMedium = triggered.some(s => MEDIUM_SIGNALS.has(s.type))
  const tier: 'LOW' | 'MEDIUM' | 'HIGH' = hasHigh ? 'HIGH' : hasMedium ? 'MEDIUM' : 'LOW'

  const amountSig     = signals.find(s => s.type === 'AMOUNT_VARIANCE')
  const frequencySig  = signals.find(s => s.type === 'FREQUENCY_ANOMALY')
  const vendorSig     = signals.find(s => s.type === 'NEW_VENDOR')
  const dupSig        = signals.find(s => s.type === 'DUPLICATE_FLAG')
  const toleranceSig  = signals.find(s => s.type === 'AMOUNT_OVER_THRESHOLD')

  return {
    evaluation: {
      overallScore,
      amountScore:       amountSig?.triggered ? (amountSig.value ?? 0) : 0,
      frequencyScore:    frequencySig?.triggered ? 1 : 0,
      vendorScore:       vendorSig?.triggered ? 1 : 0,
      duplicateScore:    dupSig?.triggered ? 1 : 0,
      toleranceScore:    toleranceSig?.triggered ? 1 : 0,
      deviation:         amountSig?.value ? amount * amountSig.value : 0,
      deviationPct:      amountSig?.value ?? 0,
      effectiveTolerance: 0.10,
    },
    tier,
  }
}

// ---------------------------------------------------------------------------
// Decision routing
// Auto-approve policy logic removed in Phase 3A — now handled by workflow engine.
// All non-duplicate invoices are routed to PENDING_REVIEW by default.
// ---------------------------------------------------------------------------

async function routeInvoiceDecision(
  invoiceId: string,
  orgId:     string,
  signals:   Signal[],
  tier:      'LOW' | 'MEDIUM' | 'HIGH',
  amount:    number,
): Promise<void> {
  const riskScore = signals.filter(s => s.triggered).reduce((sum, s) => sum + (WEIGHTS[s.type] ?? 0), 0)

  await prisma.invoiceDecision.upsert({
    where:  { invoiceId },
    create: {
      invoiceId,
      decision:  'REVIEW',
      riskScore,
      reasoning: { result: 'routed-for-review', reason: 'workflow-engine-pending', tier, amount },
      decidedAt: new Date(),
      decidedBy: 'system',
    },
    update: {
      decision:  'REVIEW',
      riskScore,
      reasoning: { result: 'routed-for-review', reason: 'workflow-engine-pending', tier, amount },
      decidedAt: new Date(),
      decidedBy: 'system',
    },
  })

  await prisma.invoice.update({
    where: { id: invoiceId },
    data:  { status: 'PENDING_REVIEW' },
  })
}

// ---------------------------------------------------------------------------
// Reminder emails for stale pending approvals (call from cron/background)
// ---------------------------------------------------------------------------

export async function sendPendingApprovalReminders(): Promise<void> {
  const pendingApprovals = await prisma.invoiceApproval.findMany({
    where: { status: 'PENDING' },
    include: {
      invoice: { include: { entity: true } },
      assignee: { include: { notificationPreference: true } },
    },
  })

  for (const approval of pendingApprovals) {
    const pref = approval.assignee.notificationPreference
    if (!pref?.reminderEnabled) continue

    const threshold = pref.reminderAfterDays ?? 3
    const ageMs     = Date.now() - approval.assignedAt.getTime()
    const ageDays   = Math.floor(ageMs / 86400000)

    if (ageDays < threshold) continue

    // Only send once per day (check lastReminderAt)
    if (approval.lastReminderAt) {
      const hoursSinceLast = (Date.now() - approval.lastReminderAt.getTime()) / 3600000
      if (hoursSinceLast < 20) continue  // already reminded today
    }

    if (!approval.assignee.email) continue

    try {
      await sendInvoiceReminderEmail({
        to:          approval.assignee.email,
        assigneeName: approval.assignee.name ?? approval.assignee.email,
        invoiceNo:   approval.invoice.invoiceNo,
        vendorName:  approval.invoice.entity.name,
        amount:      approval.invoice.amount,
        currency:    approval.invoice.currency,
        invoiceId:   approval.invoiceId,
        daysWaiting: ageDays,
      })

      await prisma.invoiceApproval.update({
        where: { id: approval.id },
        data:  { lastReminderAt: new Date() },
      })
    } catch (err) {
      console.error(`[invoice-pipeline] reminder email failed for approval ${approval.id}:`, err)
    }
  }
}
