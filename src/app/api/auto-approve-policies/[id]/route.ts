// src/app/api/auto-approve-policies/[id]/route.ts
// PUT    — update a policy (ADMIN only)
// DELETE — delete a policy (ADMIN only)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const UpdateAutoApprovePolicySchema = z.object({
  name:                  z.string().optional(),
  isActive:              z.boolean().optional(),
  currency:              z.string().optional(),
  maxAmount:             z.number().nullable().optional(),
  requireContractMatch:  z.boolean().optional(),
  requireRecurringMatch: z.boolean().optional(),
  noDuplicateFlag:       z.boolean().optional(),
  noAnomalyFlag:         z.boolean().optional(),
  allFieldsExtracted:    z.boolean().optional(),
  allowedRiskTiers:      z.array(z.string()).optional(),
  maxRiskBand:           z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).nullable().optional(),
})

const VALID_TIERS = ['LOW', 'MEDIUM', 'HIGH'] as const

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { id } = await params
    const policy = await prisma.autoApprovePolicy.findUnique({ where: { id } })
    if (!policy || policy.orgId !== session.orgId) throw new NotFoundError('Policy not found')

    const rawBody = await req.json()
    const parsed = UpdateAutoApprovePolicySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data
    const data: Record<string, unknown> = { updatedBy: session.userId }

    if (body.name      !== undefined) data.name      = sanitiseString(body.name)
    if (body.isActive  !== undefined) data.isActive  = Boolean(body.isActive)
    if (body.currency  !== undefined) data.currency  = body.currency
    if (body.maxAmount !== undefined) data.maxAmount = body.maxAmount != null ? Number(body.maxAmount) : null

    if (body.requireContractMatch  !== undefined) data.requireContractMatch  = Boolean(body.requireContractMatch)
    if (body.requireRecurringMatch !== undefined) data.requireRecurringMatch = Boolean(body.requireRecurringMatch)
    if (body.noDuplicateFlag       !== undefined) data.noDuplicateFlag       = Boolean(body.noDuplicateFlag)
    if (body.noAnomalyFlag         !== undefined) data.noAnomalyFlag         = Boolean(body.noAnomalyFlag)
    if (body.allFieldsExtracted    !== undefined) data.allFieldsExtracted    = Boolean(body.allFieldsExtracted)

    if (body.allowedRiskTiers !== undefined) {
      for (const t of body.allowedRiskTiers) {
        if (!VALID_TIERS.includes(t as never)) throw new ValidationError('Invalid risk tier')
      }
      data.allowedRiskTiers = body.allowedRiskTiers
    }

    if (body.maxRiskBand !== undefined) data.maxRiskBand = body.maxRiskBand ?? null

    await prisma.autoApprovePolicy.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/auto-approve-policies/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (session.role !== 'ADMIN') throw new ForbiddenError()

    const { id } = await params
    const policy = await prisma.autoApprovePolicy.findUnique({ where: { id } })
    if (!policy || policy.orgId !== session.orgId) throw new NotFoundError('Policy not found')

    await prisma.autoApprovePolicy.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/auto-approve-policies/[id]')
  }
}
