import { PrismaClient, WorkflowTargetType } from '@prisma/client'

/**
 * Load live data for a workflow's target object and shape it into the
 * dot-notation namespace that step conditions reference — e.g.
 * `entity.dueDiligence.sanctionsStatus`, `entity.riskBand`.
 *
 * The context stored on a WorkflowInstance is a snapshot captured when the
 * workflow started; it does NOT track later field changes (sanctions clearing,
 * risk band being computed, …). AUTO_RULE / CONDITION_BRANCH steps must be
 * evaluated against *current* state, so the engine re-hydrates the context from
 * here before re-evaluating WAITING steps.
 *
 * Returns an empty object for object types we don't hydrate yet, so callers can
 * safely spread the result over the stored context.
 */
export async function loadLiveContext(
  targetObjectType: WorkflowTargetType,
  targetObjectId: string,
  prisma: PrismaClient,
): Promise<Record<string, unknown>> {
  if (targetObjectType === 'ENTITY') {
    const entity = await prisma.entity.findUnique({
      where: { id: targetObjectId },
      include: {
        dueDiligence:    true,
        classifications: { where: { isPrimary: true }, take: 1 },
      },
    })
    if (!entity) return {}

    const primaryType = entity.classifications[0]?.type ?? null

    return {
      entity: {
        id:             entity.id,
        name:           entity.name,
        type:           primaryType,
        status:         entity.status,
        legalStructure: entity.legalStructure,
        // An active override takes precedence over the computed band, matching
        // how the rest of the app resolves the effective risk band.
        riskBand:       entity.riskBandOverride ?? entity.riskBand ?? null,
        dueDiligence: entity.dueDiligence
          ? {
              sanctionsStatus: entity.dueDiligence.sanctionsStatus,
              kycStatus:       entity.dueDiligence.kycStatus,
              kybStatus:       entity.dueDiligence.kybStatus,
              pepStatus:       entity.dueDiligence.pepStatus,
              ddLevel:         entity.dueDiligence.ddLevel,
            }
          : null,
      },
    }
  }

  return {}
}
