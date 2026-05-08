import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { safeExternalFetch } from '@/lib/security/outbound'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

interface CompletedStep {
  stepNo:      number
  status:      'IN_PROGRESS' | 'COMPLETED' | 'AUTO_COMPLETED'
  completedBy: string
  completedAt: string
  notes:       string
}

interface RuleCondition {
  id:       string
  field:    string
  operator: string
  value:    string
  nextStep: number
}

interface WorkflowStepDef {
  stepNo:             number
  title:              string
  type:               string
  required:           boolean
  blocksPayment:      boolean
  ownerRole:          string
  description:        string
  parallelGroup:      number | null
  // PROCESSING_RULE
  rules?:             RuleCondition[]
  defaultNextStep?:   number | null
  // SUB_WORKFLOW
  subWorkflowId?:     string | null
  waitForCompletion?: boolean
}

async function sendRoleNotification(
  orgId: string,
  role: string,
  subject: string,
  body: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const users = await prisma.user.findMany({
    where: { memberships: { some: { orgId, role: role as never } } },
    select: { email: true },
  })

  for (const user of users) {
    await safeExternalFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Synapse3P Onboarding <onboarding@resend.dev>',
        to:   user.email,
        subject,
        text: body,
      }),
    }).catch(() => { /* best-effort */ })
  }
}

// Evaluate a single rule condition against entity data
function evalCondition(
  cond: RuleCondition,
  entityData: { entityType: string | null; legalStructure: string; riskScore: number; jurisdiction: string | null },
): boolean {
  let fieldVal: string | number | null = null
  switch (cond.field) {
    case 'entity.entityType':     fieldVal = entityData.entityType;     break
    case 'entity.legalStructure': fieldVal = entityData.legalStructure; break
    case 'entity.riskScore':      fieldVal = entityData.riskScore;      break
    case 'entity.jurisdiction':   fieldVal = entityData.jurisdiction;   break
    default: return false
  }

  const raw = fieldVal ?? ''
  switch (cond.operator) {
    case 'eq':       return String(raw).toLowerCase() === cond.value.toLowerCase()
    case 'neq':      return String(raw).toLowerCase() !== cond.value.toLowerCase()
    case 'gt':       return Number(raw) > Number(cond.value)
    case 'lt':       return Number(raw) < Number(cond.value)
    case 'gte':      return Number(raw) >= Number(cond.value)
    case 'lte':      return Number(raw) <= Number(cond.value)
    case 'contains': return String(raw).toLowerCase().includes(cond.value.toLowerCase())
    case 'in':       return cond.value.split(',').map(v => v.trim().toLowerCase()).includes(String(raw).toLowerCase())
    default:         return false
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string; stepNo: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId, stepNo: stepNoStr } = await params
    const stepNo = parseInt(stepNoStr, 10)
    if (isNaN(stepNo) || stepNo < 1) throw new ValidationError('Invalid step number')

    const body = await req.json() as Record<string, unknown>
    const status      = sanitiseString(body.status ?? '', 20) as 'IN_PROGRESS' | 'COMPLETED'
    const notes       = sanitiseString(body.notes  ?? '', 2000)
    const completedBy = sanitiseString(body.completedBy ?? session.userId, 200)

    if (status !== 'IN_PROGRESS' && status !== 'COMPLETED') {
      throw new ValidationError('status must be IN_PROGRESS or COMPLETED')
    }

    // Load entity with primary classification
    const entity = await prisma.entity.findFirst({
      where:   { id: entityId, masterOrgId: session.orgId },
      select:  {
        id: true, name: true, legalStructure: true, riskScore: true, jurisdiction: true,
        classifications: { where: { isPrimary: true }, select: { type: true }, take: 1 },
      },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const instance = await prisma.onboardingInstance.findFirst({
      where:   { entityId, orgId: session.orgId },
      include: { workflow: { select: { steps: true } } },
      orderBy: { createdAt: 'desc' },
    })
    if (!instance) throw new NotFoundError('No onboarding instance found — start onboarding first')

    const workflowSteps = (instance.workflow.steps as unknown as WorkflowStepDef[])
    const totalSteps    = workflowSteps.length

    if (stepNo > totalSteps) throw new ValidationError(`Step ${stepNo} does not exist in this workflow`)

    const stepDef = workflowSteps.find(s => s.stepNo === stepNo)
    if (!stepDef) throw new ValidationError(`Step ${stepNo} not found in workflow`)

    const isAutoStep = stepDef.type === 'PROCESSING_RULE' || stepDef.type === 'SUB_WORKFLOW'

    // Role check: skip for auto-evaluated steps; ADMIN bypasses for human steps
    if (!isAutoStep && session.role !== 'ADMIN' && session.role !== stepDef.ownerRole) {
      throw new ForbiddenError(`Step ${stepNo} requires role: ${stepDef.ownerRole}`)
    }

    const skippedSteps = (instance.skippedSteps as unknown as number[]) ?? []

    // ── PROCESSING_RULE: auto-evaluate and route ───────────────────────────────
    if (stepDef.type === 'PROCESSING_RULE') {
      const entityData = {
        entityType:     entity.classifications[0]?.type ?? null,
        legalStructure: entity.legalStructure as string,
        riskScore:      entity.riskScore,
        jurisdiction:   entity.jurisdiction,
      }

      const rules = stepDef.rules ?? []
      let matchedNextStep: number | null = null

      for (const rule of rules) {
        if (evalCondition(rule, entityData)) {
          matchedNextStep = rule.nextStep
          break
        }
      }

      const targetStep = matchedNextStep ?? stepDef.defaultNextStep ?? stepNo + 1

      // Steps between this one and the target are skipped
      const newSkipped = [...skippedSteps]
      for (let n = stepNo + 1; n < targetStep; n++) {
        if (!newSkipped.includes(n)) newSkipped.push(n)
      }

      const completedSteps = (instance.completedSteps as unknown as CompletedStep[]).filter(s => s.stepNo !== stepNo)
      completedSteps.push({
        stepNo,
        status:      'AUTO_COMPLETED',
        completedBy: 'SYSTEM',
        completedAt: new Date().toISOString(),
        notes:       matchedNextStep
          ? `Rule matched → routed to step ${matchedNextStep}`
          : `No rule matched → ${stepDef.defaultNextStep ? `routed to step ${stepDef.defaultNextStep}` : 'advancing sequentially'}`,
      })
      completedSteps.sort((a, b) => a.stepNo - b.stepNo)

      const updatedInstance = await prisma.onboardingInstance.update({
        where: { id: instance.id },
        data:  {
          completedSteps: completedSteps as never,
          skippedSteps:   newSkipped as never,
          currentStep:    Math.min(targetStep, totalSteps),
        },
        include: { workflow: { select: { id: true, name: true, steps: true } } },
      })

      return NextResponse.json({ instance: updatedInstance, routed: true, targetStep })
    }

    // ── SUB_WORKFLOW: spawn child instance ─────────────────────────────────────
    if (stepDef.type === 'SUB_WORKFLOW') {
      if (!stepDef.subWorkflowId) throw new ValidationError('Sub-workflow is not configured on this step')

      const subWorkflow = await prisma.onboardingWorkflow.findFirst({
        where: { id: stepDef.subWorkflowId, orgId: session.orgId, isActive: true },
      })
      if (!subWorkflow) throw new NotFoundError(`Sub-workflow ${stepDef.subWorkflowId} not found or inactive`)

      // Create child instance (ignore duplicate — sub-workflow may already be running)
      let subInstance = await prisma.onboardingInstance.findFirst({
        where: { parentInstanceId: instance.id, workflowId: subWorkflow.id },
      })

      if (!subInstance) {
        subInstance = await prisma.onboardingInstance.create({
          data: {
            entityId:         entityId,
            orgId:            session.orgId,
            workflowId:       subWorkflow.id,
            parentInstanceId: instance.id,
            status:           'IN_PROGRESS',
            startedAt:        new Date(),
            currentStep:      1,
          },
        })
      }

      const completedSteps = (instance.completedSteps as unknown as CompletedStep[]).filter(s => s.stepNo !== stepNo)
      const waitForCompletion = stepDef.waitForCompletion ?? true

      completedSteps.push({
        stepNo,
        status:      waitForCompletion ? 'IN_PROGRESS' : 'COMPLETED',
        completedBy: session.userId,
        completedAt: new Date().toISOString(),
        notes:       `Sub-workflow "${subWorkflow.name}" ${waitForCompletion ? 'started — waiting for completion' : 'started (async)'}`,
      })
      completedSteps.sort((a, b) => a.stepNo - b.stepNo)

      const parentStatus = waitForCompletion ? 'PENDING_SUB_WORKFLOW' : instance.status
      const nextStep     = waitForCompletion ? stepNo : Math.min(stepNo + 1, totalSteps)

      const updatedInstance = await prisma.onboardingInstance.update({
        where: { id: instance.id },
        data:  {
          completedSteps: completedSteps as never,
          currentStep:    nextStep,
          status:         parentStatus as never,
          blockedReason:  waitForCompletion ? `Waiting for sub-workflow: ${subWorkflow.name}` : undefined,
        },
        include: { workflow: { select: { id: true, name: true, steps: true } } },
      })

      await prisma.entityActivityLog.create({
        data: {
          entityId,
          orgId:        session.orgId,
          activityType: 'ONBOARDING',
          title:        `Sub-workflow started: ${subWorkflow.name}`,
          description:  waitForCompletion
            ? `Parent workflow paused while "${subWorkflow.name}" runs`
            : `Sub-workflow "${subWorkflow.name}" triggered asynchronously`,
          performedBy:  session.userId,
          metadata:     { parentInstanceId: instance.id, subInstanceId: subInstance.id, subWorkflowId: subWorkflow.id },
        },
      })

      return NextResponse.json({ instance: updatedInstance, subInstanceId: subInstance.id })
    }

    // ── Human steps (normal flow) ──────────────────────────────────────────────

    // Merge completedSteps
    const completedSteps = (instance.completedSteps as unknown as CompletedStep[]).filter(s => s.stepNo !== stepNo)
    const thisStep: CompletedStep = {
      stepNo,
      status:      status as 'IN_PROGRESS' | 'COMPLETED',
      completedBy,
      completedAt: new Date().toISOString(),
      notes,
    }
    completedSteps.push(thisStep)
    completedSteps.sort((a, b) => a.stepNo - b.stepNo)

    // Skip over any PROCESSING_RULE / SUB_WORKFLOW / skipped steps when advancing
    const nonHumanTypes = new Set(['PROCESSING_RULE', 'SUB_WORKFLOW'])
    function nextHumanStep(from: number): number {
      let next = from + 1
      while (next <= totalSteps) {
        const def = workflowSteps.find(s => s.stepNo === next)
        if (!def) break
        if (!nonHumanTypes.has(def.type) && !skippedSteps.includes(next)) return next
        next++
      }
      return Math.min(from + 1, totalSteps)
    }

    // Determine required steps (excluding skipped and auto steps)
    const requiredStepNos = workflowSteps
      .filter(s => s.required && !nonHumanTypes.has(s.type) && !skippedSteps.includes(s.stepNo))
      .map(s => s.stepNo)
    const completedRequiredNos = new Set(
      completedSteps.filter(s => s.status === 'COMPLETED' || s.status === 'AUTO_COMPLETED').map(s => s.stepNo)
    )
    const allRequiredDone = requiredStepNos.every(n => completedRequiredNos.has(n))

    // Final step: last non-auto step in the workflow
    const humanStepNos = workflowSteps
      .filter(s => !nonHumanTypes.has(s.type) && !skippedSteps.includes(s.stepNo))
      .map(s => s.stepNo)
    const lastHumanStep = humanStepNos[humanStepNos.length - 1] ?? totalSteps
    const isFinalStep = stepNo === lastHumanStep && status === 'COMPLETED' && ['CFO', 'CONTROLLER', 'ADMIN'].includes(session.role)

    let newInstanceStatus = instance.status as string
    if (isFinalStep && allRequiredDone) {
      newInstanceStatus = 'COMPLETED'
    } else if (allRequiredDone) {
      newInstanceStatus = 'PENDING_APPROVAL'
    }

    const updatedInstance = await prisma.onboardingInstance.update({
      where: { id: instance.id },
      data:  {
        completedSteps: completedSteps as never,
        currentStep:    nextHumanStep(stepNo),
        status:         newInstanceStatus as never,
        completedAt:    newInstanceStatus === 'COMPLETED' ? new Date() : undefined,
      },
      include: { workflow: { select: { id: true, name: true, steps: true } } },
    })

    // On final approval: update org relationship and write activity log
    if (isFinalStep && allRequiredDone) {
      await prisma.entityOrgRelationship.updateMany({
        where: { entityId, orgId: session.orgId },
        data:  { onboardingStatus: 'APPROVED', activeForBillPay: true, onboardingCompletedAt: new Date() },
      })
      await prisma.entityActivityLog.create({
        data: {
          entityId,
          orgId:        session.orgId,
          activityType: 'ONBOARDING',
          title:        'Onboarding completed — entity approved for payment',
          description:  `Final approval granted by ${session.email}`,
          performedBy:  session.userId,
          metadata:     { instanceId: instance.id, approvedBy: session.userId },
        },
      })

      // If this instance was a sub-workflow, unblock the parent
      if (instance.parentInstanceId) {
        const parent = await prisma.onboardingInstance.findUnique({
          where:   { id: instance.parentInstanceId },
          include: { workflow: { select: { steps: true } } },
        })
        if (parent && parent.status === 'PENDING_SUB_WORKFLOW') {
          const parentSteps = (parent.workflow.steps as unknown as WorkflowStepDef[])
          const parentTotal = parentSteps.length
          const nextParentStep = Math.min(parent.currentStep + 1, parentTotal)

          const parentCompleted = (parent.completedSteps as unknown as CompletedStep[]).map(s =>
            s.stepNo === parent.currentStep ? { ...s, status: 'COMPLETED' as const } : s
          )

          await prisma.onboardingInstance.update({
            where: { id: parent.id },
            data:  {
              status:         'IN_PROGRESS' as never,
              currentStep:    nextParentStep,
              blockedReason:  null,
              completedSteps: parentCompleted as never,
            },
          })

          await prisma.entityActivityLog.create({
            data: {
              entityId,
              orgId:        session.orgId,
              activityType: 'ONBOARDING',
              title:        'Parent workflow resumed',
              description:  `Sub-workflow completed — parent workflow unblocked and advanced to step ${nextParentStep}`,
              performedBy:  'SYSTEM',
              metadata:     { parentInstanceId: parent.id, subInstanceId: instance.id },
            },
          })
        }
      }
    }

    // Notify LEGAL/CISO roles when their step becomes active (best-effort)
    if (stepDef.ownerRole === 'LEGAL' || stepDef.ownerRole === 'CISO') {
      sendRoleNotification(
        session.orgId,
        stepDef.ownerRole,
        `Action required: ${stepDef.title} for ${entity.name}`,
        `A new entity '${entity.name}' requires your ${stepDef.title}.\n\nPlease log in to Synapse3P to complete your review.\n\nStep ${stepNo} of ${totalSteps}.`,
      ).catch(() => { /* best-effort */ })
    }

    return NextResponse.json({ instance: updatedInstance })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/entities/[entityId]/onboarding/steps/[stepNo]')
  }
}
