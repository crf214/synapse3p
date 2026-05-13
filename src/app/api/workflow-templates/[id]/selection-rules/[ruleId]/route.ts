// src/app/api/workflow-templates/[id]/selection-rules/[ruleId]/route.ts — PATCH (toggle) + DELETE

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

const PatchRuleSchema = z.object({
  isActive: z.boolean(),
})

// ---------------------------------------------------------------------------
// PATCH — toggle isActive
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id: templateId, ruleId } = await params

    const rule = await prisma.templateSelectionRule.findFirst({
      where:   { id: ruleId, templateId },
      include: { template: { select: { orgId: true } } },
    })
    if (!rule || rule.template.orgId !== session.orgId) throw new NotFoundError('Rule not found')

    const rawBody = await req.json()
    const parsed  = PatchRuleSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
    }

    const updated = await prisma.templateSelectionRule.update({
      where: { id: ruleId },
      data:  { isActive: parsed.data.isActive },
    })

    return NextResponse.json({ rule: updated })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/workflow-templates/[id]/selection-rules/[ruleId]')
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete rule
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id: templateId, ruleId } = await params

    const rule = await prisma.templateSelectionRule.findFirst({
      where:   { id: ruleId, templateId },
      include: { template: { select: { orgId: true } } },
    })
    if (!rule || rule.template.orgId !== session.orgId) throw new NotFoundError('Rule not found')

    await prisma.templateSelectionRule.delete({ where: { id: ruleId } })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/workflow-templates/[id]/selection-rules/[ruleId]')
  }
}
