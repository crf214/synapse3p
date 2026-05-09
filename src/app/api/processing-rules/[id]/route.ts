// src/app/api/processing-rules/[id]/route.ts
// PUT    — update a rule (ADMIN only)
// DELETE — delete a rule (ADMIN only)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const UpdateProcessingRuleSchema = z.object({
  name:                 z.string().optional(),
  description:          z.string().nullable().optional(),
  notes:                z.string().nullable().optional(),
  isActive:             z.boolean().optional(),
  requiresGoodsReceipt: z.boolean().optional(),
  requiresContract:     z.boolean().optional(),
  track:                z.string().optional(),
  priority:             z.number().optional(),
  conditions:           z.record(z.unknown()).optional(),
})

const VALID_TRACKS = ['FULL_PO', 'LIGHTWEIGHT', 'STP', 'CONTRACT_REQUIRED'] as const

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { id } = await params
    const rule = await prisma.processingRule.findUnique({ where: { id } })
    if (!rule || rule.orgId !== session.orgId) throw new NotFoundError('Processing rule not found')

    const rawBody = await req.json()
    const parsed = UpdateProcessingRuleSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data
    const data: Record<string, unknown> = { updatedBy: session.userId }

    if (body.name        !== undefined) data.name        = sanitiseString(body.name)
    if (body.description !== undefined) data.description = body.description ? sanitiseString(body.description) : null
    if (body.notes       !== undefined) data.notes       = body.notes       ? sanitiseString(body.notes)       : null
    if (body.isActive    !== undefined) data.isActive    = Boolean(body.isActive)
    if (body.requiresGoodsReceipt !== undefined) data.requiresGoodsReceipt = Boolean(body.requiresGoodsReceipt)
    if (body.requiresContract     !== undefined) data.requiresContract     = Boolean(body.requiresContract)

    if (body.track !== undefined) {
      if (!VALID_TRACKS.includes(body.track as never)) throw new ValidationError(`track must be one of: ${VALID_TRACKS.join(', ')}`)
      data.track = body.track
    }
    if (body.priority !== undefined) {
      if (body.priority < 1) throw new ValidationError('priority must be a positive integer')
      data.priority = body.priority
    }
    if (body.conditions !== undefined) {
      data.conditions = body.conditions
    }

    await prisma.processingRule.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/processing-rules/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { id } = await params
    const rule = await prisma.processingRule.findUnique({ where: { id } })
    if (!rule || rule.orgId !== session.orgId) throw new NotFoundError('Processing rule not found')

    await prisma.processingRule.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/processing-rules/[id]')
  }
}
