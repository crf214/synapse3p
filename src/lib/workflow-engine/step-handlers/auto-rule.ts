import { PrismaClient } from '@prisma/client'
import type { StepResult, Condition, ConditionOperator } from '../types'
import { evaluateConditions } from '../condition-evaluator'

interface SideEffect {
  action: string
  value:  string
}

// Config shape: { conditions: Condition[], operator: 'AND' | 'OR', sideEffect?: SideEffect }
export async function handleAutoRuleStep(
  _stepInstanceId: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  prisma?: PrismaClient,
): Promise<StepResult> {
  const conditions = (config.conditions ?? []) as Condition[]
  const operator   = (config.operator ?? 'AND') as ConditionOperator

  const passed = evaluateConditions(conditions, operator, context)

  // Execute side effects when conditions pass
  if (passed && config.sideEffect && prisma) {
    const sideEffect = config.sideEffect as SideEffect
    if (sideEffect.action === 'SET_ENTITY_STATUS') {
      const objectId = (context.targetObjectId as string | undefined) ?? ''
      if (objectId) {
        try {
          await prisma.entity.update({
            where: { id: objectId },
            data:  { status: sideEffect.value as never },
          })
          console.log(`[AutoRule:SET_ENTITY_STATUS] Entity ${objectId} → ${sideEffect.value}`)
        } catch (err) {
          console.error('[AutoRule:SET_ENTITY_STATUS] Failed to update entity status:', err)
        }
      }
    }
  }

  return {
    status: 'COMPLETED',
    result: passed ? 'PASS' : 'FAIL',
  }
}
