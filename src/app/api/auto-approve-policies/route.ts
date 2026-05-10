// src/app/api/auto-approve-policies/route.ts
// GET  — list all auto-approve policies for the org
// POST — create a new policy (ADMIN only)
//
// One policy per org/entity combination enforced by DB unique constraint.
// entityId = null → org-wide default; entityId set → per-entity override.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateAutoApprovePolicySchema = z.object({
  name:                  z.string().min(1),
  entityId:              z.string().optional().nullable(),
  maxAmount:             z.number().optional().nullable(),
  currency:              z.string().optional(),
  requireContractMatch:  z.boolean().optional(),
  requireRecurringMatch: z.boolean().optional(),
  allowedRiskTiers:      z.array(z.string()).optional(),
  noDuplicateFlag:       z.boolean().optional(),
  noAnomalyFlag:         z.boolean().optional(),
  allFieldsExtracted:    z.boolean().optional(),
  maxRiskBand:           z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional().nullable(),
})

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const VALID_TIERS   = ['LOW', 'MEDIUM', 'HIGH'] as const

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const policies = await prisma.autoApprovePolicy.findMany({
      where:   { orgId: session.orgId! },
      orderBy: [{ entityId: 'asc' }, { createdAt: 'asc' }],
    })

    // Batch-resolve entity names, creator/updater names
    const entityIds = policies.map(p => p.entityId).filter(Boolean) as string[]
    const userIds   = new Set<string>()
    for (const p of policies) {
      userIds.add(p.createdBy)
      if (p.updatedBy) userIds.add(p.updatedBy)
    }

    const [entities, users] = await Promise.all([
      entityIds.length > 0
        ? prisma.entity.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
        : [],
      userIds.size > 0
        ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, email: true } })
        : [],
    ])

    const entityMap = Object.fromEntries(entities.map(e => [e.id, e]))
    const userMap   = Object.fromEntries(users.map(u => [u.id, u]))

    return NextResponse.json({
      policies: policies.map(p => ({
        id:                    p.id,
        name:                  p.name,
        isActive:              p.isActive,
        entityId:              p.entityId,
        entity:                p.entityId ? (entityMap[p.entityId] ?? null) : null,
        maxAmount:             p.maxAmount !== null ? Number(p.maxAmount) : null,
        currency:              p.currency,
        requireContractMatch:  p.requireContractMatch,
        requireRecurringMatch: p.requireRecurringMatch,
        allowedRiskTiers:      p.allowedRiskTiers,
        noDuplicateFlag:       p.noDuplicateFlag,
        noAnomalyFlag:         p.noAnomalyFlag,
        allFieldsExtracted:    p.allFieldsExtracted,
        maxRiskBand:           p.maxRiskBand ?? null,
        createdAt:             p.createdAt.toISOString(),
        updatedAt:             p.updatedAt.toISOString(),
        creator:               userMap[p.createdBy]  ?? null,
        updater:               p.updatedBy ? (userMap[p.updatedBy] ?? null) : null,
      })),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/auto-approve-policies')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreateAutoApprovePolicySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const {
      name, entityId, maxAmount, currency,
      requireContractMatch, requireRecurringMatch,
      allowedRiskTiers, noDuplicateFlag, noAnomalyFlag, allFieldsExtracted,
      maxRiskBand,
    } = parsed.data

    const tiers = (allowedRiskTiers ?? []) as string[]
    for (const t of tiers) {
      if (!VALID_TIERS.includes(t as never)) {
        throw new ValidationError(`allowedRiskTiers values must be LOW, MEDIUM, or HIGH`)
      }
    }

    // Validate entity belongs to org if specified
    if (entityId) {
      const entity = await prisma.entity.findFirst({
        where: { id: entityId, masterOrgId: session.orgId! },
      })
      if (!entity) throw new ValidationError('Entity not found')
    }

    // Check unique constraint
    const existing = await prisma.autoApprovePolicy.findFirst({
      where: { orgId: session.orgId!, entityId: entityId ?? null },
    })
    if (existing) {
      throw new ValidationError(
        entityId
          ? 'A policy for this entity already exists'
          : 'An org-wide default policy already exists'
      )
    }

    const policy = await prisma.autoApprovePolicy.create({
      data: {
        orgId:                 session.orgId!,
        name:                  sanitiseString(name),
        entityId:              entityId ?? null,
        maxAmount:             maxAmount != null ? Number(maxAmount) : null,
        currency:              currency ?? 'USD',
        requireContractMatch:  requireContractMatch  ?? true,
        requireRecurringMatch: requireRecurringMatch ?? false,
        allowedRiskTiers:      tiers as never[],
        noDuplicateFlag:       noDuplicateFlag  ?? true,
        noAnomalyFlag:         noAnomalyFlag    ?? true,
        allFieldsExtracted:    allFieldsExtracted ?? false,
        maxRiskBand:           maxRiskBand ?? null,
        createdBy:             session.userId,
        isActive:              true,
      },
    })

    return NextResponse.json({ id: policy.id }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/auto-approve-policies')
  }
}
