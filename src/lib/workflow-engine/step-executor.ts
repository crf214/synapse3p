import { PrismaClient, WorkflowTargetType } from '@prisma/client'
import type { StepResult, Condition } from './types'
import { getNestedValue } from './condition-evaluator'
import { handleApprovalStep }        from './step-handlers/approval'
import { handleAutoRuleStep }        from './step-handlers/auto-rule'
import { handleConditionBranchStep } from './step-handlers/condition-branch'
import { handleNotificationStep }    from './step-handlers/notification'
import { handleWaitForStep }         from './step-handlers/wait-for'
import { handleSubWorkflowStep }     from './step-handlers/sub-workflow'

type StartWorkflowFn = (
  templateId: string,
  targetObjectType: WorkflowTargetType,
  targetObjectId: string,
  orgId: string,
  ctx?: Record<string, unknown>,
  parentInstanceId?: string,
  parentStepInstanceId?: string,
) => Promise<string>

export async function executeStep(
  stepInstanceId: string,
  workflowInstanceId: string,
  prisma: PrismaClient,
  startWorkflow: StartWorkflowFn,
): Promise<StepResult> {
  // 1. Fetch stepInstance with stepDefinition and workflowInstance (include context)
  const stepInstance = await prisma.workflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    include: {
      stepDefinition:  true,
      workflowInstance: true,
    },
  })

  if (!stepInstance) {
    return { status: 'FAILED', error: 'Step instance not found' }
  }

  const { stepDefinition, workflowInstance } = stepInstance
  const config  = (stepDefinition.config  ?? {}) as Record<string, unknown>
  const context = (workflowInstance.context ?? {}) as Record<string, unknown>

  // 2. Check onMissingContext — validate the context fields this step actually
  //    reads. These are the condition fields declared in the step config (NOT
  //    `dependencies`, which are step-ordering references resolved by the
  //    engine). A field is "missing" only when it resolves to undefined against
  //    the live context; a present-but-failing value (e.g. sanctions FLAGGED)
  //    is a real PASS/FAIL evaluation, not a reason to WAIT.
  if (stepDefinition.onMissingContext !== 'FAIL') {
    // WAIT and SKIP are handled here (FAIL is the default — no special check needed)
    const requiredFields = getRequiredContextFields(stepDefinition.stepType, config)
    const missingFields  = requiredFields.filter(f => getNestedValue(context, f) === undefined)

    if (missingFields.length > 0) {
      if (stepDefinition.onMissingContext === 'WAIT') {
        await prisma.workflowStepInstance.update({
          where: { id: stepInstanceId },
          data:  { status: 'WAITING' },
        })
        return { status: 'WAITING' }
      }
      if (stepDefinition.onMissingContext === 'SKIP') {
        await prisma.workflowStepInstance.update({
          where: { id: stepInstanceId },
          data:  { status: 'SKIPPED', completedAt: new Date() },
        })
        return { status: 'SKIPPED' }
      }
    }
  }

  // 3. Dispatch to correct handler based on stepType
  let result: StepResult

  try {
    switch (stepDefinition.stepType) {
      case 'APPROVAL':
        result = await handleApprovalStep(
          stepInstanceId,
          stepDefinition.id,
          config,
          context,
          prisma,
        )
        break

      case 'AUTO_RULE':
        result = await handleAutoRuleStep(stepInstanceId, config, context, prisma)
        break

      case 'CONDITION_BRANCH':
        result = await handleConditionBranchStep(stepInstanceId, config, context)
        break

      case 'NOTIFICATION':
        result = await handleNotificationStep(stepInstanceId, config, context)
        break

      case 'WAIT_FOR':
        result = await handleWaitForStep(stepInstanceId, config, context, prisma)
        break

      case 'SUB_WORKFLOW':
        result = await handleSubWorkflowStep(
          stepInstanceId,
          config,
          context,
          workflowInstance.orgId,
          prisma,
          startWorkflow,
          workflowInstanceId,
        )
        break

      default:
        result = { status: 'FAILED', error: `Unknown step type: ${stepDefinition.stepType}` }
    }
  } catch (err) {
    result = {
      status: 'FAILED',
      error:  err instanceof Error ? err.message : String(err),
    }
  }

  // 4. Update stepInstance status/result in DB
  if (result.status !== 'IN_PROGRESS' && result.status !== 'WAITING') {
    await prisma.workflowStepInstance.update({
      where: { id: stepInstanceId },
      data: {
        status:      result.status as never,
        result:      result.result as never ?? null,
        completedAt: new Date(),
        metadata:    (result.metadata ?? {}) as never,
      },
    })
  }

  return result
}

/**
 * The context fields a step reads when it runs. Used to decide whether a step
 * with `onMissingContext: WAIT | SKIP` should defer because the data it needs
 * is not yet present. Only condition-driven step types reference context fields;
 * everything else returns [] (nothing to wait on).
 */
function getRequiredContextFields(
  stepType: string,
  config: Record<string, unknown>,
): string[] {
  const fields: string[] = []

  const collect = (conditions: Condition[] | undefined) => {
    for (const c of conditions ?? []) {
      // Special async sentinels (e.g. __THREE_WAY_MATCH__) are resolved by the
      // handler against the database, not the context — never wait on them.
      if (c.field && !c.field.startsWith('__')) fields.push(c.field)
    }
  }

  if (stepType === 'AUTO_RULE') {
    collect(config.conditions as Condition[] | undefined)
  } else if (stepType === 'CONDITION_BRANCH') {
    const branches = (config.branches ?? []) as Array<{ conditions?: Condition[] }>
    for (const branch of branches) collect(branch.conditions)
  }

  return fields
}
