// src/app/api/workflow-templates/[id]/validate/route.ts — POST (validate template)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const template = await prisma.workflowTemplate.findFirst({
      where:   { id, orgId: session.orgId },
      include: { steps: { orderBy: { order: 'asc' } } },
    })
    if (!template) throw new NotFoundError('Template not found')

    const errors: string[] = []

    if (template.steps.length === 0) {
      errors.push('Template has no steps defined.')
    }

    for (const step of template.steps) {
      const config    = (step.config    ?? {}) as Record<string, unknown>
      const nextSteps = (step.nextSteps ?? {}) as Record<string, unknown>

      // All terminal-path steps should have nextSteps defined (empty {} is OK for leaf steps)
      // CONDITION_BRANCH: must have branches in config
      if (step.stepType === 'CONDITION_BRANCH') {
        const branches = config.branches
        if (!Array.isArray(branches) || branches.length === 0) {
          errors.push(`Step "${step.name}" (order ${step.order}): CONDITION_BRANCH must have at least one branch defined in config.`)
        }
        if (!config.defaultNextStepOrder && !config.defaultNextStepId) {
          errors.push(`Step "${step.name}" (order ${step.order}): CONDITION_BRANCH must have a defaultNextStepOrder or defaultNextStepId.`)
        }
      }

      // WAIT_FOR: must have a timeout strategy
      if (step.stepType === 'WAIT_FOR') {
        if (!config.timeoutHours && !config.timeoutDays) {
          errors.push(`Step "${step.name}" (order ${step.order}): WAIT_FOR step must define timeoutHours or timeoutDays.`)
        }
      }

      // AUTO_RULE: should have conditions array
      if (step.stepType === 'AUTO_RULE') {
        if (!Array.isArray(config.conditions)) {
          errors.push(`Step "${step.name}" (order ${step.order}): AUTO_RULE must have a conditions array (can be empty for unconditional pass).`)
        }
      }

      // APPROVAL: should define assigneeRule
      if (step.stepType === 'APPROVAL') {
        if (!config.assigneeRule) {
          errors.push(`Step "${step.name}" (order ${step.order}): APPROVAL step must define an assigneeRule.`)
        }
      }

      // Non-leaf steps should have nextSteps
      const isLeaf = step.stepType === 'NOTIFICATION' || step.stepType === 'WAIT_FOR'
      if (!isLeaf && Object.keys(nextSteps).length === 0) {
        // CONDITION_BRANCH routes via config.branches, not nextSteps — that's OK
        if (step.stepType !== 'CONDITION_BRANCH') {
          errors.push(`Step "${step.name}" (order ${step.order}): non-leaf step has no nextSteps defined.`)
        }
      }
    }

    const isValid = errors.length === 0

    if (isValid) {
      await prisma.workflowTemplate.update({
        where: { id },
        data:  { isValid: true },
      })
    }

    return NextResponse.json({ isValid, errors })
  } catch (err) {
    return handleApiError(err, 'POST /api/workflow-templates/[id]/validate')
  }
}
