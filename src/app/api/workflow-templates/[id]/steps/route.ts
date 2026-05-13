// src/app/api/workflow-templates/[id]/steps/route.ts — POST (add step)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

const AddStepSchema = z.object({
  name:             z.string().min(1).max(200),
  description:      z.string().max(1000).optional(),
  stepType:         z.enum(['APPROVAL', 'AUTO_RULE', 'CONDITION_BRANCH', 'NOTIFICATION', 'WAIT_FOR', 'SUB_WORKFLOW']),
  executionMode:    z.enum(['SYNC', 'ASYNC']).default('SYNC'),
  onMissingContext: z.enum(['FAIL', 'WAIT', 'SKIP']).default('FAIL'),
  order:            z.number().int().min(0).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id: templateId } = await params

    const template = await prisma.workflowTemplate.findFirst({ where: { id: templateId, orgId: session.orgId } })
    if (!template) throw new NotFoundError('Template not found')

    const rawBody = await req.json()
    const parsed  = AddStepSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
    }

    const { data } = parsed

    // Default order = last step + 1
    let order = data.order
    if (order === undefined) {
      const lastStep = await prisma.workflowStepDefinition.findFirst({
        where:   { templateId },
        orderBy: { order: 'desc' },
        select:  { order: true },
      })
      order = (lastStep?.order ?? -1) + 1
    }

    const step = await prisma.workflowStepDefinition.create({
      data: {
        templateId,
        name:             sanitiseString(data.name, 200).trim(),
        description:      data.description ? sanitiseString(data.description, 1000).trim() : null,
        stepType:         data.stepType,
        executionMode:    data.executionMode,
        onMissingContext: data.onMissingContext,
        order,
        config:           {} as never,
        nextSteps:        {} as never,
        dependencies:     [] as never,
      },
    })

    // Deactivate template isValid since a new step was added
    await prisma.workflowTemplate.update({
      where: { id: templateId },
      data:  { isValid: false },
    })

    return NextResponse.json({ step }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/workflow-templates/[id]/steps')
  }
}
