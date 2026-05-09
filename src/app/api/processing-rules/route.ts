// src/app/api/processing-rules/route.ts
// GET  — list all processing rules for the org (ordered by priority)
// POST — create a new rule

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateProcessingRuleSchema = z.object({
  name:                 z.string().min(1),
  description:          z.string().optional().nullable(),
  priority:             z.number().int().min(1),
  track:                z.string().min(1),
  conditions:           z.record(z.unknown()),
  requiresGoodsReceipt: z.boolean().optional(),
  requiresContract:     z.boolean().optional(),
  notes:                z.string().optional().nullable(),
})

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const WRITE_ROLES   = new Set(['ADMIN'])

const VALID_TRACKS = ['FULL_PO', 'LIGHTWEIGHT', 'STP', 'CONTRACT_REQUIRED'] as const

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rules = await prisma.processingRule.findMany({
      where:   { orgId: session.orgId! },
      orderBy: { priority: 'asc' },
    })

    // Batch-resolve creator/updater names
    const userIds = new Set<string>()
    for (const r of rules) {
      userIds.add(r.createdBy)
      if (r.updatedBy) userIds.add(r.updatedBy)
    }
    const users = userIds.size > 0
      ? await prisma.user.findMany({
          where:  { id: { in: [...userIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    return NextResponse.json({
      rules: rules.map(r => ({
        id:                   r.id,
        name:                 r.name,
        description:          r.description,
        priority:             r.priority,
        isActive:             r.isActive,
        conditions:           r.conditions,
        track:                r.track,
        requiresGoodsReceipt: r.requiresGoodsReceipt,
        requiresContract:     r.requiresContract,
        notes:                r.notes,
        createdAt:            r.createdAt.toISOString(),
        updatedAt:            r.updatedAt.toISOString(),
        creator:              userMap[r.createdBy]  ?? null,
        updater:              r.updatedBy ? (userMap[r.updatedBy] ?? null) : null,
      })),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/processing-rules')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreateProcessingRuleSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const { name, description, priority, track, conditions,
            requiresGoodsReceipt, requiresContract, notes } = parsed.data

    if (!VALID_TRACKS.includes(track as never)) throw new ValidationError(`track must be one of: ${VALID_TRACKS.join(', ')}`)

    const rule = await prisma.processingRule.create({
      data: {
        orgId:                session.orgId!,
        name:                 sanitiseString(name),
        description:          description ? sanitiseString(description) : null,
        priority,
        track:      track as never,
        conditions: conditions as never,
        requiresGoodsReceipt: requiresGoodsReceipt ?? false,
        requiresContract:     requiresContract     ?? false,
        notes:                notes ? sanitiseString(notes) : null,
        createdBy:            session.userId,
        isActive:             true,
      },
    })

    return NextResponse.json({ id: rule.id }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/processing-rules')
  }
}
