// src/app/api/workflow-templates/[id]/route.ts — GET (detail) + PUT (update)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const UpdateTemplateSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  isActive:    z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// GET — template detail with steps and selection rules
// ---------------------------------------------------------------------------

export async function GET(
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
      include: {
        steps:          { orderBy: { order: 'asc' } },
        selectionRules: { orderBy: { priority: 'asc' } },
        _count:         { select: { instances: true } },
      },
    })
    if (!template) throw new NotFoundError('Template not found')

    return NextResponse.json({ template })
  } catch (err) {
    return handleApiError(err, 'GET /api/workflow-templates/[id]')
  }
}

// ---------------------------------------------------------------------------
// PUT — update name, description, isActive
// ---------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params

    const existing = await prisma.workflowTemplate.findFirst({ where: { id, orgId: session.orgId } })
    if (!existing) throw new NotFoundError('Template not found')

    const rawBody = await req.json()
    const parsed  = UpdateTemplateSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
    }

    const { data } = parsed

    // When activating, clear isValid so it must be re-validated
    const updateData: Record<string, unknown> = {}
    if (data.name        !== undefined) updateData.name        = sanitiseString(data.name, 200).trim()
    if (data.description !== undefined) updateData.description = sanitiseString(data.description, 1000).trim() || null
    if (data.isActive    !== undefined) {
      updateData.isActive = data.isActive
      if (!data.isActive) updateData.isValid = false
    }

    const template = await prisma.workflowTemplate.update({
      where: { id },
      data:  updateData as never,
    })

    return NextResponse.json({ template })
  } catch (err) {
    return handleApiError(err, 'PUT /api/workflow-templates/[id]')
  }
}
