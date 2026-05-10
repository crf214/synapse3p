// src/lib/risk/check-review-cadence.ts
//
// Identifies entities that are overdue for a third-party review based on
// their risk band and the org's configured review cadences.

import { PrismaClient } from '@prisma/client'

export interface EntityDueForReview {
  entityId:     string
  entityName:   string
  riskBand:     string | null
  lastReviewAt: Date | null
  daysOverdue:  number
  cadenceDays:  number
}

// Default cadence (days) per risk band — used when no cadence record exists.
const BAND_DEFAULTS: Record<string, number> = {
  LOW:      365,
  MEDIUM:   180,
  HIGH:      90,
  CRITICAL:  30,
}

// Map a risk score range (riskScoreMin / riskScoreMax) to a band label.
// ReviewCadence stores score ranges — we derive the effective band name from
// the midpoint so we can merge records into a per-band map.
function scoresToBand(min: number, max: number): string {
  const mid = (min + max) / 2
  if (mid <= 3)  return 'LOW'
  if (mid <= 6)  return 'MEDIUM'
  if (mid <= 8)  return 'HIGH'
  return 'CRITICAL'
}

export async function getEntitiesDueForReview(
  orgId: string,
  prisma: PrismaClient,
): Promise<EntityDueForReview[]> {
  // 1. Build band → cadenceDays map from stored cadences.
  const cadenceRecords = await prisma.reviewCadence.findMany({
    where: { orgId, isActive: true },
  })

  const bandMap: Record<string, number> = { ...BAND_DEFAULTS }
  for (const c of cadenceRecords) {
    const band = scoresToBand(c.riskScoreMin, c.riskScoreMax)
    // Last writer wins — if multiple cadences cover the same band, prefer the
    // one with the highest reviewIntervalDays (most lenient, safer default).
    if (bandMap[band] === undefined || c.reviewIntervalDays > bandMap[band]) {
      bandMap[band] = c.reviewIntervalDays
    }
  }

  // 2. Fetch active entities with their most recent review.
  const entities = await prisma.entity.findMany({
    where: {
      masterOrgId: orgId,
      status: {
        notIn: ['INACTIVE', 'OFFBOARDED'],
      },
    },
    select: {
      id:        true,
      name:      true,
      riskBand:  true,
      createdAt: true,
      thirdPartyReviews: {
        orderBy: { createdAt: 'desc' },
        take:    1,
        select:  { completedAt: true, createdAt: true },
      },
    },
  })

  const now = Date.now()
  const result: EntityDueForReview[] = []

  for (const entity of entities) {
    const band = entity.riskBand ?? null
    const cadenceDays = band ? (bandMap[band] ?? 180) : 180

    // Determine last review date: prefer completedAt, fall back to createdAt of review.
    const lastReview = entity.thirdPartyReviews[0] ?? null
    const lastReviewAt: Date | null = lastReview
      ? (lastReview.completedAt ?? lastReview.createdAt)
      : null

    let daysOverdue: number

    if (lastReviewAt) {
      const daysSinceReview = Math.floor(
        (now - lastReviewAt.getTime()) / 86_400_000,
      )
      daysOverdue = daysSinceReview - cadenceDays
    } else {
      // Never reviewed — overdue since the entity was old enough.
      const entityAgeDays = Math.floor(
        (now - entity.createdAt.getTime()) / 86_400_000,
      )
      daysOverdue = entityAgeDays - cadenceDays
    }

    if (daysOverdue > 0) {
      result.push({
        entityId:     entity.id,
        entityName:   entity.name,
        riskBand:     band,
        lastReviewAt,
        daysOverdue,
        cadenceDays,
      })
    }
  }

  // Sort most overdue first.
  result.sort((a, b) => b.daysOverdue - a.daysOverdue)

  return result
}
