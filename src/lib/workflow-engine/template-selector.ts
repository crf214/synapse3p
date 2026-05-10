import { PrismaClient, WorkflowTargetType } from '@prisma/client'
import { evaluateConditions } from './condition-evaluator'
import type { Condition, ConditionOperator } from './types'

interface StoredConditionGroup {
  conditions: Condition[]
  operator?: ConditionOperator
}

export async function selectTemplate(
  triggerEvent: string,
  targetObjectType: WorkflowTargetType,
  objectData: Record<string, unknown>,
  orgId: string,
  prisma: PrismaClient,
): Promise<string | null> {
  // Fetch all active selection rules for this org + targetObjectType + triggerEvent
  // ordered by priority ASC (lower number = higher priority)
  const rules = await prisma.templateSelectionRule.findMany({
    where: {
      orgId,
      targetObjectType,
      triggerEvent,
      isActive: true,
    },
    orderBy: { priority: 'asc' },
  })

  for (const rule of rules) {
    const conditionGroup = rule.conditions as unknown as StoredConditionGroup | Condition[]

    let conditions: Condition[]
    let operator: ConditionOperator

    if (Array.isArray(conditionGroup)) {
      conditions = conditionGroup
      operator = 'AND'
    } else {
      conditions = conditionGroup.conditions ?? []
      operator = conditionGroup.operator ?? 'AND'
    }

    const matches = evaluateConditions(conditions, operator, objectData)
    if (matches) {
      return rule.templateId
    }
  }

  return null
}
