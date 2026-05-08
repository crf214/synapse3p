// Shared types and constants for onboarding workflow step definitions

export const VALID_STEP_TYPES = new Set([
  'INFORMATION', 'DOCUMENT', 'REVIEW', 'APPROVAL', 'EXTERNAL_CHECK',
  'PROCESSING_RULE', 'SUB_WORKFLOW',
])

export const VALID_OPERATORS = new Set(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in'])

export interface RuleCondition {
  id:       string
  field:    string
  operator: string
  value:    string
  nextStep: number
}

export interface StepDef {
  stepNo:        number
  title:         string
  type:          string
  required:      boolean
  blocksPayment: boolean
  ownerRole:     string
  description:   string
  parallelGroup: number | null
  // PROCESSING_RULE extras
  rules?:           RuleCondition[]
  defaultNextStep?: number | null
  // SUB_WORKFLOW extras
  subWorkflowId?:       string | null
  waitForCompletion?:   boolean
}
