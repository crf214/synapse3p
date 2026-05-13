// src/app/api/workflow-templates/[id]/steps/[stepId]/route.ts — PUT (update) + DELETE (delete)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

const UpdateStepSchema = z.object({
  name:             z.string().min(1).max(200).optional(),
  description:      z.string().max(1000).optional(),
  order:            z.number().int().min(0).optional(),
  onMissingContext: z.enum(['FAIL', 'WAIT', 'SKIP']).optional(),
  config:           z.record(z.unknown()).optional(),
  nextSteps:        z.record(z.unknown()).optional(),
})

// ---------------------------------------------------------------------------
// PUT — update step order or config
// ---------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id: templateId, stepId } = await params

    const step = await prisma.workflowStepDefinition.findFirst({
      where: { id: stepId, templateId },
      include: { template: { select: { orgId: true } } },
    })
    if (!step || step.template.orgId !== session.orgId) throw new NotFoundError('Step not found')

    const rawBody = await req.json()
    const parsed  = UpdateStepSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
    }

    const { data } = parsed
    const updateData: Record<string, unknown> = {}
    if (data.name             !== undefined) updateData.name             = sanitiseString(data.name, 200).trim()
    if (data.description      !== undefined) updateData.description      = sanitiseString(data.description, 1000).trim() || null
    if (data.order            !== undefined) updateData.order            = data.order
    if (data.onMissingContext !== undefined) updateData.onMissingContext = data.onMissingContext
    if (data.config           !== undefined) updateData.config           = data.config
    if (data.nextSteps        !== undefined) updateData.nextSteps        = data.nextSteps

    const updated = await prisma.workflowStepDefinition.update({
      where: { id: stepId },
      data:  updateData as never,
    })

    await prisma.workflowTemplate.update({
      where: { id: templateId },
      data:  { isValid: false },
    })

    return NextResponse.json({ step: updated })
  } catch (err) {
    return handleApiError(err, 'PUT /api/workflow-templates/[id]/steps/[stepId]')
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete step (only if template is not active)
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id: templateId, stepId } = await params

    const step = await prisma.workflowStepDefinition.findFirst({
      where:   { id: stepId, templateId },
      include: { template: { select: { orgId: true, isActive: true } } },
    })
    if (!step || step.template.orgId !== session.orgId) throw new NotFoundError('Step not found')
    if (step.template.isActive) {
      throw new ValidationError('Cannot delete steps from an active template. Deactivate the template first.')
    }

    await prisma.workflowStepDefinition.delete({ where: { id: stepId } })
    await prisma.workflowTemplate.update({ where: { id: templateId }, data: { isValid: false } })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/workflow-templates/[id]/steps/[stepId]')
  }
}
