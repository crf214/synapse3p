// src/lib/risk/compute-risk-band.ts
//
// 2A risk band computation engine.
// Scores an entity across three pillars:
//   - Entity characteristics (weight 0.40)
//   - Financial exposure     (weight 0.35)
//   - Qualitative determination (weight 0.25)

import { PrismaClient, RiskBand } from '@prisma/client'

// ---------------------------------------------------------------------------
// Band derivation
// ---------------------------------------------------------------------------

export function scoreToBand(score: number): RiskBand {
  if (score >= 86) return 'CRITICAL'
  if (score >= 61) return 'HIGH'
  if (score >= 31) return 'MEDIUM'
  return 'LOW'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskFactors {
  entityCharacteristics: {
    score: number
    weight: number
    inputs: Record<string, unknown>
  }
  financialExposure: {
    score: number
    weight: number
    inputs: Record<string, unknown>
  }
  qualitativeDetermination: {
    score: number
    weight: number
    inputs: Record<string, unknown>
  }
}

export interface RiskComputationResult {
  score: number
  band: RiskBand
  factors: RiskFactors
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export async function computeEntityRisk(
  entityId: string,
  prisma: PrismaClient,
): Promise<RiskComputationResult> {

  // ── 1. Entity characteristics (weight: 0.40) ─────────────────────────────

  const entity = await prisma.entity.findUnique({
    where:   { id: entityId },
    include: {
      classifications: { where: { isPrimary: true }, take: 1 },
      dueDiligence:    true,
    },
  })

  if (!entity) {
    throw new Error(`Entity ${entityId} not found`)
  }

  let charScore = 0
  const charInputs: Record<string, unknown> = {}

  // KYC/KYB status — prefer KYC, fall back to KYB
  const dd = entity.dueDiligence
  const kycStatus = dd?.kycStatus ?? null
  const kybStatus = dd?.kybStatus ?? null

  // Determine effective verification status
  // Priority: FAILED > IN_REVIEW > APPROVED > PENDING > missing
  let verificationStatus: string | null = null
  if (kycStatus && kycStatus !== 'NOT_REQUIRED') {
    verificationStatus = kycStatus
  } else if (kybStatus && kybStatus !== 'NOT_REQUIRED') {
    verificationStatus = kybStatus
  }

  let kycKybScore = 40 // default / missing
  if (verificationStatus === 'APPROVED')  kycKybScore = 0
  if (verificationStatus === 'IN_REVIEW') kycKybScore = 50
  if (verificationStatus === 'FAILED')    kycKybScore = 80
  if (verificationStatus === 'PENDING')   kycKybScore = 40
  charInputs.kycStatus = kycStatus
  charInputs.kybStatus = kybStatus
  charInputs.verificationStatus = verificationStatus
  charInputs.kycKybScore = kycKybScore

  // Entity type — use primary classification
  const primaryType = entity.classifications[0]?.type ?? null
  const entityTypeScoreMap: Record<string, number> = {
    VENDOR:           10,
    CONTRACTOR:       20,
    BROKER:           40,
    PLATFORM:         10,
    FUND_SVC_PROVIDER: 20,
    OTHER:            30,
  }
  const entityTypeScore = primaryType ? (entityTypeScoreMap[primaryType] ?? 20) : 20
  charInputs.entityType = primaryType
  charInputs.entityTypeScore = entityTypeScore

  // Relationship age
  const ageMs = Date.now() - entity.createdAt.getTime()
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
  let ageScore = 30
  if (ageDays > 365)       ageScore = 0
  else if (ageDays > 180)  ageScore = 10
  else if (ageDays > 90)   ageScore = 20
  charInputs.relationshipAgeDays = ageDays
  charInputs.ageScore = ageScore

  // Sanctions flag — check EntityDueDiligence sanctionsStatus
  let sanctionsAddition = 0
  const sanctionsStatus = dd?.sanctionsStatus ?? null
  if (sanctionsStatus === 'FLAGGED' || sanctionsStatus === 'BLOCKED' || sanctionsStatus === 'UNDER_REVIEW') {
    sanctionsAddition = 40
  }
  charInputs.sanctionsStatus = sanctionsStatus
  charInputs.sanctionsAddition = sanctionsAddition

  charScore = Math.min(100, kycKybScore + entityTypeScore + ageScore + sanctionsAddition)
  charInputs.rawSum = kycKybScore + entityTypeScore + ageScore + sanctionsAddition
  charInputs.cappedScore = charScore

  // ── 2. Financial exposure (weight: 0.35) ─────────────────────────────────

  let finScore = 0
  const finInputs: Record<string, unknown> = {}

  const financial = await prisma.entityFinancial.findUnique({
    where: { entityId },
  })

  // YTD spend — EntityFinancial uses `spendYTD`
  const spendYTD = financial?.spendYTD ?? null
  let spendScore = 10
  if (spendYTD !== null) {
    if (spendYTD > 1_000_000)      spendScore = 60
    else if (spendYTD > 500_000)   spendScore = 40
    else if (spendYTD > 100_000)   spendScore = 20
    else                           spendScore = 10
  }
  finInputs.spendYTD = spendYTD
  finInputs.spendScore = spendScore

  // Outstanding invoices (not PAID / CANCELLED / REJECTED)
  const now = new Date()
  const [outstandingCount, overdueCount] = await Promise.all([
    prisma.invoice.count({
      where: {
        entityId,
        status: { notIn: ['PAID', 'CANCELLED', 'REJECTED'] },
      },
    }),
    prisma.invoice.count({
      where: {
        entityId,
        dueDate: { lt: now },
        status:  { notIn: ['PAID', 'CANCELLED', 'REJECTED'] },
      },
    }),
  ])

  let outstandingScore = 10
  if (outstandingCount > 10)      outstandingScore = 40
  else if (outstandingCount >= 5) outstandingScore = 20
  else                            outstandingScore = 10
  finInputs.outstandingInvoiceCount = outstandingCount
  finInputs.outstandingScore = outstandingScore

  const overdueScore = overdueCount > 0 ? 30 : 0
  finInputs.overdueInvoiceCount = overdueCount
  finInputs.overdueScore = overdueScore

  finScore = Math.min(100, spendScore + outstandingScore + overdueScore)
  finInputs.rawSum = spendScore + outstandingScore + overdueScore
  finInputs.cappedScore = finScore

  // ── 3. Qualitative determination (weight: 0.25) ──────────────────────────

  let qualScore = 50 // neutral default
  const qualInputs: Record<string, unknown> = {}

  const latestReview = await prisma.thirdPartyReview.findFirst({
    where:   { entityId },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, overallScore: true, status: true },
  })

  if (latestReview?.overallScore !== null && latestReview?.overallScore !== undefined) {
    // Inverted: high review score = low risk
    qualScore = Math.min(100, Math.max(0, 100 - latestReview.overallScore))
    qualInputs.reviewId = latestReview.id
    qualInputs.reviewStatus = latestReview.status
    qualInputs.reviewOverallScore = latestReview.overallScore
    qualInputs.invertedScore = qualScore
  } else {
    qualInputs.reviewId = latestReview?.id ?? null
    qualInputs.reviewStatus = latestReview?.status ?? null
    qualInputs.reviewOverallScore = null
    qualInputs.note = 'No review with score found; using neutral default of 50'
  }

  // ── Final weighted score ─────────────────────────────────────────────────

  const score = Math.round(
    (charScore * 0.40) +
    (finScore  * 0.35) +
    (qualScore * 0.25),
  )
  const band = scoreToBand(score)

  return {
    score,
    band,
    factors: {
      entityCharacteristics: {
        score:  charScore,
        weight: 0.40,
        inputs: charInputs,
      },
      financialExposure: {
        score:  finScore,
        weight: 0.35,
        inputs: finInputs,
      },
      qualitativeDetermination: {
        score:  qualScore,
        weight: 0.25,
        inputs: qualInputs,
      },
    },
  }
}
