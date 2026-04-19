import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { safeExternalFetch } from '@/lib/security/outbound'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO'])

interface CompletedStep {
  stepNo:      number
  status:      'IN_PROGRESS' | 'COMPLETED'
  completedBy: string
  completedAt: string
  notes:       string
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
    if (isNaN(stepNo) || stepNo < 1 || stepNo > 7) throw new ValidationError('Invalid step number')

    const body = await req.json() as Record<string, unknown>
    const status      = sanitiseString(body.status ?? '', 20) as 'IN_PROGRESS' | 'COMPLETED'
    const notes       = sanitiseString(body.notes  ?? '', 2000)
    const completedBy = sanitiseString(body.completedBy ?? session.userId, 200)

    if (status !== 'IN_PROGRESS' && status !== 'COMPLETED') {
      throw new ValidationError('status must be IN_PROGRESS or COMPLETED')
    }

    // Load entity + instance
    const entity = await prisma.entity.findFirst({
      where:   { id: entityId, masterOrgId: session.orgId },
      select:  { id: true, name: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const instance = await prisma.onboardingInstance.findFirst({
      where:   { entityId, orgId: session.orgId },
      include: { workflow: { select: { steps: true } } },
      orderBy: { createdAt: 'desc' },
    })
    if (!instance) throw new NotFoundError('No onboarding instance found — start onboarding first')

    // Role check: ADMIN may complete any step; otherwise the user's role must
    // match the step's ownerRole as defined in the workflow.
    const workflowStepDef = (instance.workflow.steps as { stepNo: number; ownerRole: string; title: string }[])
      .find(s => s.stepNo === stepNo)
    if (!workflowStepDef) throw new ValidationError(`Step ${stepNo} not found in workflow`)
    if (session.role !== 'ADMIN' && session.role !== workflowStepDef.ownerRole) {
      throw new ForbiddenError(`Step ${stepNo} requires role: ${workflowStepDef.ownerRole}`)
    }

    // Merge completedSteps
    const completedSteps = (instance.completedSteps as unknown as CompletedStep[]).filter(s => s.stepNo !== stepNo)
    const thisStep: CompletedStep = {
      stepNo,
      status,
      completedBy,
      completedAt: new Date().toISOString(),
      notes,
    }
    completedSteps.push(thisStep)
    completedSteps.sort((a, b) => a.stepNo - b.stepNo)

    // Determine new instance status
    const workflowSteps = (instance.workflow.steps as { stepNo: number; required: boolean }[])
    const requiredStepNos = workflowSteps.filter(s => s.required).map(s => s.stepNo)
    const completedRequiredNos = new Set(completedSteps.filter(s => s.status === 'COMPLETED').map(s => s.stepNo))
    const allRequiredDone = requiredStepNos.every(n => completedRequiredNos.has(n))

    // Step 7 final approval (all required steps done + final approver role)
    const isFinalApproval = stepNo === 7 && status === 'COMPLETED' && ['CFO', 'CONTROLLER', 'ADMIN'].includes(session.role)

    let newInstanceStatus = instance.status as string
    if (isFinalApproval && allRequiredDone) {
      newInstanceStatus = 'COMPLETED'
    } else if (allRequiredDone) {
      newInstanceStatus = 'PENDING_APPROVAL'
    }

    const updatedInstance = await prisma.onboardingInstance.update({
      where: { id: instance.id },
      data:  {
        completedSteps: completedSteps as never,
        currentStep:    Math.min(stepNo + 1, 7),
        status:         newInstanceStatus as never,
        completedAt:    newInstanceStatus === 'COMPLETED' ? new Date() : undefined,
      },
      include: { workflow: { select: { id: true, name: true, steps: true } } },
    })

    // On final approval: update org relationship and write activity log
    if (isFinalApproval && allRequiredDone) {
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
    }

    // Notify LEGAL/CISO roles when their step is completed (best-effort — never block the response)
    const stepDef = (instance.workflow.steps as { stepNo: number; ownerRole: string; title: string }[])
      .find(s => s.stepNo === stepNo)
    if (stepDef?.ownerRole === 'LEGAL' || stepDef?.ownerRole === 'CISO') {
      sendRoleNotification(
        session.orgId,
        stepDef.ownerRole,
        `Action required: ${stepDef.title} for ${entity.name}`,
        `A new entity '${entity.name}' requires your ${stepDef.title}.\n\nPlease log in to Synapse3P to complete your review.\n\nEntity onboarding step ${stepNo} of 7.`,
      ).catch(() => { /* best-effort */ })
    }

    return NextResponse.json({ instance: updatedInstance })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/entities/[entityId]/onboarding/steps/[stepNo]')
  }
}
