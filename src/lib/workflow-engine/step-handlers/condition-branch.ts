import type { StepResult, Condition, ConditionOperator } from '../types'
import { evaluateConditions } from '../condition-evaluator'

interface Branch {
  conditions: Condition[]
  operator?: ConditionOperator
  nextStepId: string
}

// Config shape: { branches: Branch[], defaultNextStepId?: string }
export async function handleConditionBranchStep(
  _stepInstanceId: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<StepResult> {
  const branches         = (config.branches ?? []) as Branch[]
  const defaultNextStepId = config.defaultNextStepId as string | undefined

  let winningNextStepId: string | undefined

  for (const branch of branches) {
    const operator = branch.operator ?? 'AND'
    if (evaluateConditions(branch.conditions, operator, context)) {
      winningNextStepId = branch.nextStepId
      break
    }
  }

  if (!winningNextStepId) {
    winningNextStepId = defaultNextStepId
  }

  return {
    status:   'COMPLETED',
    result:   'PASS',
    metadata: { nextStepId: winningNextStepId ?? null },
  }
}
