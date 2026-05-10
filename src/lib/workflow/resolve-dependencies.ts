// Resolve pending StepDependency records and unblock WAITING WorkflowStepInstances.
//
// Call this after a significant state transition — e.g. when an entity moves out
// of PROVISIONAL status — so any workflow step instances that were gated on that
// transition can automatically advance to IN_PROGRESS.

import { PrismaClient, DependencyType } from '@prisma/client'

// Re-export for callers that want the enum without importing from @prisma/client directly.
export { DependencyType }

/**
 * Mark all matching unresolved StepDependency records as resolved, then
 * transition any WorkflowStepInstance whose ALL dependencies are now resolved
 * from WAITING → IN_PROGRESS.
 *
 * @returns The number of WorkflowStepInstances that were unblocked.
 */
export async function resolveStepDependencies(
  dependencyType: DependencyType,
  subjectId: string,
  prisma: PrismaClient,
): Promise<number> {
  // 1. Find all unresolved matching dependencies
  const unresolved = await prisma.stepDependency.findMany({
    where: { dependencyType, subjectId, resolvedAt: null },
    select: { id: true, stepId: true },
  })

  if (unresolved.length === 0) return 0

  const now     = new Date()
  const depIds  = unresolved.map(d => d.id)
  const stepIds = [...new Set(unresolved.map(d => d.stepId))]

  // 2. Mark them resolved
  await prisma.stepDependency.updateMany({
    where: { id: { in: depIds } },
    data:  { resolvedAt: now },
  })

  // 3. For each affected step instance, check if ALL dependencies are now resolved
  let unblockedCount = 0

  for (const stepInstanceId of stepIds) {
    const remaining = await prisma.stepDependency.count({
      where: { stepId: stepInstanceId, resolvedAt: null },
    })

    if (remaining === 0) {
      // All dependencies satisfied — advance from WAITING to IN_PROGRESS
      const updated = await prisma.workflowStepInstance.updateMany({
        where: { id: stepInstanceId, status: 'WAITING' },
        data:  { status: 'IN_PROGRESS' },
      })
      if (updated.count > 0) unblockedCount++
    }
  }

  return unblockedCount
}
