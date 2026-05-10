import { PrismaClient } from '@prisma/client'
import type { StepResult } from '../types'

// Config shape: { assignTo: string (userId or role), notifyEmail?: boolean }
export async function handleApprovalStep(
  stepInstanceId: string,
  _stepDefinitionId: string,
  config: Record<string, unknown>,
  _context: Record<string, unknown>,
  prisma: PrismaClient,
): Promise<StepResult> {
  const assignTo = typeof config.assignTo === 'string' ? config.assignTo : null

  await prisma.workflowStepInstance.update({
    where: { id: stepInstanceId },
    data: {
      assignedTo: assignTo,
      startedAt:  new Date(),
      status:     'IN_PROGRESS',
    },
  })

  // Approval completion comes via WorkflowEngine.completeStep() called externally
  return { status: 'IN_PROGRESS' }
}
