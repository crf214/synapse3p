import { PrismaClient, WorkflowTargetType } from '@prisma/client'
import type { StepResult } from '../types'

// Config shape: { templateId: string, waitForCompletion: boolean, contextMapping: Record<string, string> }
// Calls engine.startWorkflow() for the child template.
// Circular import avoided by accepting startWorkflow as a callback.
export async function handleSubWorkflowStep(
  stepInstanceId: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  orgId: string,
  prisma: PrismaClient,
  startWorkflow: (
    templateId: string,
    targetObjectType: WorkflowTargetType,
    targetObjectId: string,
    orgId: string,
    ctx?: Record<string, unknown>,
    parentInstanceId?: string,
    parentStepInstanceId?: string,
  ) => Promise<string>,
  parentInstanceId: string,
): Promise<StepResult> {
  const templateId        = typeof config.templateId === 'string' ? config.templateId : null
  const waitForCompletion = config.waitForCompletion !== false
  const contextMapping    = (config.contextMapping ?? {}) as Record<string, string>

  if (!templateId) {
    return { status: 'FAILED', error: 'sub-workflow step missing templateId in config' }
  }

  // H3: Cycle detection — walk up to 10 ancestor instances to ensure the
  // same templateId does not appear anywhere in the active call chain.
  const MAX_DEPTH = 10
  let ancestorId: string | null = parentInstanceId
  const seenTemplateIds: string[] = []
  let depth = 0

  while (ancestorId && depth < MAX_DEPTH) {
    const ancestor: { templateId: string; parentInstanceId: string | null } | null =
      await prisma.workflowInstance.findUnique({
        where:  { id: ancestorId },
        select: { templateId: true, parentInstanceId: true },
      })
    if (!ancestor) break
    seenTemplateIds.push(ancestor.templateId)
    if (ancestor.templateId === templateId) {
      return {
        status: 'FAILED',
        error:  `Circular sub-workflow detected: template ${templateId} appears in the active call chain`,
      }
    }
    ancestorId = ancestor.parentInstanceId ?? null
    depth++
  }

  // Build child context by mapping fields from parent context
  const childContext: Record<string, unknown> = {}
  for (const [targetKey, sourceKey] of Object.entries(contextMapping)) {
    if (sourceKey in context) childContext[targetKey] = context[sourceKey]
  }

  // Determine targetObjectType and targetObjectId from context
  const targetObjectType = (context.targetObjectType as WorkflowTargetType) ?? 'ENTITY'
  const targetObjectId   = (context.targetObjectId   as string) ?? ''

  await startWorkflow(
    templateId,
    targetObjectType,
    targetObjectId,
    orgId,
    childContext,
    parentInstanceId,
    stepInstanceId,
  )

  if (waitForCompletion) {
    // Mark step as WAITING — parent engine will advance when sub-workflow completes
    await prisma.workflowStepInstance.update({
      where: { id: stepInstanceId },
      data:  { status: 'WAITING' },
    })
    return { status: 'WAITING' }
  }

  return { status: 'COMPLETED', result: 'PASS' }
}
