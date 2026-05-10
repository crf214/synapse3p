import { PrismaClient, DependencyType } from '@prisma/client'
import type { StepResult } from '../types'

// Config shape: { dependencyType: DependencyType, subjectIdField: string }
export async function handleWaitForStep(
  stepInstanceId: string,
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  prisma: PrismaClient,
): Promise<StepResult> {
  const dependencyType  = config.dependencyType as DependencyType
  const subjectIdField  = typeof config.subjectIdField === 'string' ? config.subjectIdField : ''

  // Resolve the subject ID from context using the field name
  const subjectId = typeof context[subjectIdField] === 'string'
    ? (context[subjectIdField] as string)
    : String(context[subjectIdField] ?? '')

  if (!dependencyType || !subjectId) {
    return {
      status: 'FAILED',
      error:  'wait-for step missing dependencyType or subjectIdField in context',
    }
  }

  await prisma.stepDependency.create({
    data: {
      stepId:         stepInstanceId,
      dependencyType,
      subjectId,
    },
  })

  return { status: 'WAITING' }
}
