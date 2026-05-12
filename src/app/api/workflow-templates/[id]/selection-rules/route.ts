// src/app/api/workflow-templates/[id]/selection-rules/route.ts — POST (add rule)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

const AddRuleSchema = z.object({
  priority:     z.number().int().min(1).max(999),
  triggerEvent: z.string().min(1).max(100),
  conditions:   z.array(z.object({
    field:    z.string(),
    operator: z.string(),
    value:    z.unknown(),
  })).default([]),
  isActive:     z.boolean().default(true),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id: templateId } = await params

    const template = await prisma.workflowTemplate.findFirst({ where: { id: templateId, orgId: session.orgId } })
    if (!template) throw new NotFoundError('Template not found')

    const rawBody = await req.json()
    const parsed  = AddRuleSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
    }

    const { data } = parsed

    const rule = await prisma.templateSelectionRule.create({
      data: {
        templateId,
        orgId:            session.orgId,
        priority:         data.priority,
        triggerEvent:     data.triggerEvent,
        targetObjectType: template.targetObjectType,
        conditions:       data.conditions as never,
        isActive:         data.isActive,
      },
    })

    return NextResponse.json({ rule }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/workflow-templates/[id]/selection-rules')
  }
}
