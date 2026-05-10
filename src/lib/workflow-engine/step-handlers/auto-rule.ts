import type { StepResult, Condition, ConditionOperator } from '../types'
import { evaluateConditions } from '../condition-evaluator'

// Config shape: { conditions: Condition[], operator: 'AND' | 'OR' }
export async function handleAutoRuleStep(
  _stepInstanceId: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<StepResult> {
  const conditions = (config.conditions ?? []) as Condition[]
  const operator   = (config.operator ?? 'AND') as ConditionOperator

  const passed = evaluateConditions(conditions, operator, context)

  return {
    status: 'COMPLETED',
    result: passed ? 'PASS' : 'FAIL',
  }
}
