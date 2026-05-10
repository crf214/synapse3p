import type { Condition, ConditionOperator } from './types'

/**
 * Resolve a dot-notation field path against a nested object.
 * e.g. "entity.riskBand" against { entity: { riskBand: "HIGH" } } → "HIGH"
 */
function getNestedValue(obj: Record<string, unknown>, field: string): unknown {
  const parts = field.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function evaluateCondition(
  condition: Condition,
  objectData: Record<string, unknown>,
): boolean {
  const actual = getNestedValue(objectData, condition.field)
  const { operator, value } = condition

  switch (operator) {
    case 'eq':
      return actual === value
    case 'neq':
      return actual !== value
    case 'gt':
      return typeof actual === 'number' && typeof value === 'number' && actual > value
    case 'gte':
      return typeof actual === 'number' && typeof value === 'number' && actual >= value
    case 'lt':
      return typeof actual === 'number' && typeof value === 'number' && actual < value
    case 'lte':
      return typeof actual === 'number' && typeof value === 'number' && actual <= value
    case 'in':
      return Array.isArray(value) && value.includes(actual)
    case 'not_in':
      return Array.isArray(value) && !value.includes(actual)
    case 'contains':
      return typeof actual === 'string' && typeof value === 'string' && actual.includes(value)
    case 'exists':
      return value ? actual != null : actual == null
    default:
      return false
  }
}

export function evaluateConditions(
  conditions: Condition[],
  operator: ConditionOperator,
  objectData: Record<string, unknown>,
): boolean {
  if (conditions.length === 0) return true

  if (operator === 'AND') {
    return conditions.every(c => evaluateCondition(c, objectData))
  }
  // OR
  return conditions.some(c => evaluateCondition(c, objectData))
}
