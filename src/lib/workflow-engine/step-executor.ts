import { PrismaClient, WorkflowTargetType } from '@prisma/client'
import type { StepResult } from './types'
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

  // 2. Check onMissingContext — validate required context fields
  if (stepDefinition.onMissingContext !== 'FAIL') {
    // WAIT and SKIP are handled here (FAIL is the default — no special check needed)
    const dependencies = (stepDefinition.dependencies ?? []) as string[]
    const missingFields = dependencies.filter(f => !(f in context))

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
        result = await handleAutoRuleStep(stepInstanceId, config, context)
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
