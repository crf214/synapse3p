export type ConditionOperator = 'AND' | 'OR'
export type ComparisonOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'exists'

export interface Condition {
  field: string
  operator: ComparisonOperator
  value: unknown
}

export interface StepResult {
  status: 'PENDING' | 'IN_PROGRESS' | 'WAITING' | 'COMPLETED' | 'SKIPPED' | 'FAILED'
  result?: 'PASS' | 'FAIL'
  metadata?: Record<string, unknown>
  error?: string
}

export interface NextStep {
  stepDefinitionId: string
  condition?: { result: 'PASS' | 'FAIL' } | null
}
