import { PrismaClient, WorkflowTargetType } from '@prisma/client'
import { executeStep } from './step-executor'
import { loadLiveContext } from './context-loader'

const TERMINAL_STATUSES = new Set(['COMPLETED', 'SKIPPED', 'FAILED'])

export class WorkflowEngine {
  constructor(private prisma: PrismaClient) {}

  async startWorkflow(
    templateId: string,
    targetObjectType: WorkflowTargetType,
    targetObjectId: string,
    orgId: string,
    context?: Record<string, unknown>,
    parentInstanceId?: string,
    parentStepInstanceId?: string,
  ): Promise<string> {
    // 1. Fetch template with steps
    const template = await this.prisma.workflowTemplate.findUnique({
      where:   { id: templateId },
      include: { steps: { orderBy: { order: 'asc' } } },
    })

    if (!template) {
      throw new Error(`WorkflowTemplate not found: ${templateId}`)
    }

    const baseContext: Record<string, unknown> = {
      ...(context ?? {}),
      targetObjectType,
      targetObjectId,
    }

    // 2. Create WorkflowInstance (status: IN_PROGRESS, startedAt: now)
    const instance = await this.prisma.workflowInstance.create({
      data: {
        templateId,
        templateVersion:     template.version,
        orgId,
        targetObjectType,
        targetObjectId,
        status:              'IN_PROGRESS',
        parentInstanceId:    parentInstanceId    ?? null,
        parentStepInstanceId: parentStepInstanceId ?? null,
        context:             baseContext as never,
        startedAt:           new Date(),
      },
    })

    // 3. Create WorkflowStepInstance records for all steps (status: PENDING)
    if (template.steps.length > 0) {
      await this.prisma.workflowStepInstance.createMany({
        data: template.steps.map(step => ({
          workflowInstanceId: instance.id,
          stepDefinitionId:   step.id,
          status:             'PENDING' as const,
        })),
      })
    }

    // 4. Find first step(s) (order=0 or steps with no declared dependencies)
    const firstSteps = template.steps.filter(s => {
      const deps = (s.dependencies ?? []) as unknown[]
      return s.order === 0 || deps.length === 0
    })

    // 5. Execute first step(s)
    const createdStepInstances = await this.prisma.workflowStepInstance.findMany({
      where: { workflowInstanceId: instance.id },
      include: { stepDefinition: true },
    })

    for (const stepDef of firstSteps) {
      const stepInstance = createdStepInstances.find(
        si => si.stepDefinitionId === stepDef.id,
      )
      if (stepInstance) {
        await executeStep(stepInstance.id, instance.id, this.prisma, this.startWorkflow.bind(this))
      }
    }

    // Check if already complete (e.g. single auto-rule step)
    await this.checkAndFinalise(instance.id)

    return instance.id
  }

  async advanceWorkflow(instanceId: string): Promise<void> {
    // 1. Fetch instance
    const instance = await this.prisma.workflowInstance.findUnique({
      where:  { id: instanceId },
      select: {
        id:               true,
        status:           true,
        context:          true,
        targetObjectType: true,
        targetObjectId:   true,
      },
    })

    if (!instance || instance.status === 'COMPLETED' || instance.status === 'CANCELLED') {
      return
    }

    // 2. Re-hydrate the workflow context with live target-object data so that
    //    WAITING AUTO_RULE / CONDITION_BRANCH steps re-evaluate against current
    //    state (e.g. sanctionsStatus now CLEAR, riskBand now computed) rather
    //    than the snapshot taken when the workflow started. executeStep reads
    //    the persisted instance context, so persist the merge before sweeping.
    const liveContext = await loadLiveContext(
      instance.targetObjectType,
      instance.targetObjectId,
      this.prisma,
    )
    if (Object.keys(liveContext).length > 0) {
      const mergedContext = {
        ...((instance.context as Record<string, unknown> | null) ?? {}),
        ...liveContext,
      }
      await this.prisma.workflowInstance.update({
        where: { id: instanceId },
        data:  { context: mergedContext as never },
      })
    }

    // 3. Sweep steps to a fixpoint. Executing one step (e.g. a WAITING AUTO_RULE
    //    that now passes against the refreshed context) can unblock the next
    //    step, so keep sweeping until a full pass changes nothing. Re-fetch each
    //    pass so newly-completed steps are visible to dependents; the bound
    //    guards against any pathological non-convergence.
    const maxPasses = 50
    for (let pass = 0; pass < maxPasses; pass++) {
      const stepInstances = await this.prisma.workflowStepInstance.findMany({
        where:   { workflowInstanceId: instanceId },
        include: { stepDefinition: true },
      })

      let progressed = false

      for (const stepInstance of stepInstances) {
        const isPending = stepInstance.status === 'PENDING'
        const isWaiting = stepInstance.status === 'WAITING'
        // Only PENDING (gated by dependencies) and WAITING (re-evaluated against
        // refreshed context) steps are actionable; everything else is terminal
        // or already running.
        if (!isPending && !isWaiting) continue

        if (isPending) {
          const deps = (stepInstance.stepDefinition.dependencies ?? []) as string[]
          const allDepsComplete = deps.every(depStepDefId => {
            const depInstance = stepInstances.find(
              si => si.stepDefinitionId === depStepDefId,
            )
            return depInstance && TERMINAL_STATUSES.has(depInstance.status)
          })
          if (!allDepsComplete) continue
        }

        const before = stepInstance.status
        const result = await executeStep(
          stepInstance.id,
          instanceId,
          this.prisma,
          this.startWorkflow.bind(this),
        )
        // A step that re-runs and stays WAITING (data still absent) is not
        // progress — without this guard the sweep would never terminate.
        if (result.status !== before) progressed = true
      }

      if (!progressed) break
    }

    // 4. Check if all steps are terminal
    await this.checkAndFinalise(instanceId)
  }

  private async checkAndFinalise(instanceId: string): Promise<void> {
    const stepInstances = await this.prisma.workflowStepInstance.findMany({
      where: { workflowInstanceId: instanceId },
      select: { status: true, result: true },
    })

    if (stepInstances.length === 0) return

    const allTerminal = stepInstances.every(si => TERMINAL_STATUSES.has(si.status))
    if (!allTerminal) return

    const anyFailed = stepInstances.some(si => si.status === 'FAILED')

    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: {
        status:      anyFailed ? 'FAILED' : 'COMPLETED',
        completedAt: new Date(),
      },
    })
  }

  async completeStep(
    stepInstanceId: string,
    result: 'PASS' | 'FAIL',
    completedBy: string,
    notes?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // 1. Update stepInstance
    const stepInstance = await this.prisma.workflowStepInstance.update({
      where: { id: stepInstanceId },
      data: {
        status:      'COMPLETED',
        result:      result as never,
        completedAt: new Date(),
        completedBy,
        notes:       notes   ?? null,
        metadata:    (metadata ?? {}) as never,
      },
    })

    // 2. Advance the workflow
    await this.advanceWorkflow(stepInstance.workflowInstanceId)
  }

  async cancelWorkflow(instanceId: string, cancelledBy: string): Promise<void> {
    // 1. Update instance
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: {
        status:      'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy,
      },
    })

    // 2. Update all PENDING/IN_PROGRESS stepInstances to FAILED
    await this.prisma.workflowStepInstance.updateMany({
      where: {
        workflowInstanceId: instanceId,
        status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING'] },
      },
      data: {
        status:      'FAILED',
        completedAt: new Date(),
      },
    })
  }
}
