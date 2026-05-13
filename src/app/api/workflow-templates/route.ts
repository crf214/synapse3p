// src/app/api/workflow-templates/route.ts — GET (list) + POST (create)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const CreateTemplateSchema = z.object({
  name:             z.string().min(1).max(200),
  targetObjectType: z.enum(['ENTITY', 'INVOICE', 'PURCHASE_ORDER']),
  description:      z.string().max(1000).optional(),
})

// ---------------------------------------------------------------------------
// GET — list all templates for the org, grouped by targetObjectType
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const templates = await prisma.workflowTemplate.findMany({
      where:   { orgId: session.orgId },
      orderBy: [{ targetObjectType: 'asc' }, { name: 'asc' }],
      include: {
        _count:         { select: { steps: true, instances: true } },
        selectionRules: { select: { id: true, isActive: true }, where: { isActive: true } },
      },
    })

    const grouped = {
      ENTITY:         templates.filter(t => t.targetObjectType === 'ENTITY'),
      INVOICE:        templates.filter(t => t.targetObjectType === 'INVOICE'),
      PURCHASE_ORDER: templates.filter(t => t.targetObjectType === 'PURCHASE_ORDER'),
    }

    return NextResponse.json({ templates: grouped })
  } catch (err) {
    return handleApiError(err, 'GET /api/workflow-templates')
  }
}

// ---------------------------------------------------------------------------
// POST — create new template
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed  = CreateTemplateSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
    }

    const { data } = parsed

    const template = await prisma.workflowTemplate.create({
      data: {
        name:             sanitiseString(data.name, 200).trim(),
        description:      data.description ? sanitiseString(data.description, 1000).trim() : null,
        targetObjectType: data.targetObjectType,
        isActive:         false,
        isValid:          false,
        version:          1,
        createdBy:        session.userId,
        orgId:            session.orgId,
      },
    })

    return NextResponse.json({ template }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/workflow-templates')
  }
}
