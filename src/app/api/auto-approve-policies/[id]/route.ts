// src/app/api/auto-approve-policies/[id]/route.ts
// PUT    — update a policy (ADMIN only)
// DELETE — delete a policy (ADMIN only)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

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

    const body = await req.json()
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
      if (!Array.isArray(body.allowedRiskTiers)) throw new ValidationError('allowedRiskTiers must be an array')
      for (const t of body.allowedRiskTiers as string[]) {
        if (!VALID_TIERS.includes(t as never)) throw new ValidationError('Invalid risk tier')
      }
      data.allowedRiskTiers = body.allowedRiskTiers
    }

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
