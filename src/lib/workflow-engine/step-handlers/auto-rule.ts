import { PrismaClient } from '@prisma/client'
import type { StepResult, Condition, ConditionOperator } from '../types'
import { evaluateConditions } from '../condition-evaluator'
import { performThreeWayMatch } from '@/lib/matching/three-way-match'

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

  // Special async condition: three-way match check
  // Use { field: '__THREE_WAY_MATCH__', operator: 'eq', value: true } in workflow config
  const hasThreeWayMatchCondition = conditions.some(c => c.field === '__THREE_WAY_MATCH__')
  if (hasThreeWayMatchCondition) {
    if (!prisma) {
      return { status: 'COMPLETED', result: 'FAIL', error: 'Prisma not available for three-way match check' }
    }
    const invoiceId = context.targetObjectId as string | undefined
    if (!invoiceId) {
      return { status: 'COMPLETED', result: 'FAIL', error: 'No targetObjectId in context for three-way match' }
    }
    const invoice = await prisma.invoice.findUnique({
      where:  { id: invoiceId },
      select: { poId: true },
    })
    if (!invoice?.poId) {
      return { status: 'COMPLETED', result: 'FAIL', metadata: { reason: 'No PO linked to invoice' } }
    }
    const matchResult = await performThreeWayMatch(invoice.poId, invoiceId, prisma)
    return {
      status:   'COMPLETED',
      result:   matchResult.passed ? 'PASS' : 'FAIL',
      metadata: { matchChecks: matchResult.checks, failureReason: matchResult.failureReason },
    }
  }

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

    if (sideEffect.action === 'SET_PO_STATUS') {
      const objectId = (context.targetObjectId as string | undefined) ?? ''
      if (objectId) {
        try {
          await prisma.purchaseOrder.update({
            where: { id: objectId },
            data:  { status: sideEffect.value as never },
          })
          console.log(`[AutoRule:SET_PO_STATUS] PurchaseOrder ${objectId} → ${sideEffect.value}`)
        } catch (err) {
          console.error('[AutoRule:SET_PO_STATUS] Failed to update PO status:', err)
        }
      }
    }
  }

  return {
    status: 'COMPLETED',
    result: passed ? 'PASS' : 'FAIL',
  }
}
