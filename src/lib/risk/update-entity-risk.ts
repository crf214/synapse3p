// src/lib/risk/update-entity-risk.ts
//
// Persists a fresh risk computation for an entity, respecting any band override.

import { PrismaClient, RiskBand } from '@prisma/client'
import { computeEntityRisk } from './compute-risk-band'

export async function updateEntityRisk(
  entityId: string,
  prisma: PrismaClient,
): Promise<RiskBand> {
  // 1. Compute
  const { score, band: computedBand, factors } = await computeEntityRisk(entityId, prisma)

  // 2. Check override
  const entity = await prisma.entity.findUnique({
    where:  { id: entityId },
    select: { riskBandOverride: true },
  })

  const effectiveBand: RiskBand = entity?.riskBandOverride ?? computedBand

  // 3. Update Entity
  await prisma.entity.update({
    where: { id: entityId },
    data:  {
      riskBand:         effectiveBand,
      riskBandUpdatedAt: new Date(),
      // riskScore field exists on Entity — keep it in sync
      riskScore:        score,
    },
  })

  // 4. Create EntityRiskScore record
  await prisma.entityRiskScore.create({
    data: {
      entityId,
      // Legacy fields — keep consistent
      computedScore:       score,
      weights:             { entityCharacteristics: 0.40, financialExposure: 0.35, qualitativeDetermination: 0.25 },
      // 2A band fields
      score,
      band:                effectiveBand,
      computedAt:          new Date(),
      factors:             factors as object,
    },
  })

  return effectiveBand
}
