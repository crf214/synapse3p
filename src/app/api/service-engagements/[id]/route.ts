// src/app/api/service-engagements/[id]/route.ts
// GET    — full detail
// PUT    — update fields
// DELETE — remove engagement

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const eng = await prisma.serviceEngagement.findUnique({
      where:   { id: params.id },
      include: {
        entity:           { select: { id: true, name: true } },
        serviceCatalogue: { select: { id: true, name: true, category: true, description: true } },
      },
    })
    if (!eng || eng.orgId !== session.orgId) throw new NotFoundError('Service engagement not found')

    // Resolve owner name
    let owner: { id: string; name: string | null; email: string } | null = null
    if (eng.internalOwner) {
      owner = await prisma.user.findUnique({
        where:  { id: eng.internalOwner },
        select: { id: true, name: true, email: true },
      })
    }

    return NextResponse.json({
      id:              eng.id,
      status:          eng.status,
      slaStatus:       eng.slaStatus,
      slaTarget:       eng.slaTarget,
      department:      eng.department,
      contractStart:   eng.contractStart?.toISOString() ?? null,
      contractEnd:     eng.contractEnd?.toISOString() ?? null,
      lastReviewedAt:  eng.lastReviewedAt?.toISOString() ?? null,
      complianceDocs:  eng.complianceDocs,
      notes:           eng.notes,
      createdAt:       eng.createdAt.toISOString(),
      updatedAt:       eng.updatedAt.toISOString(),
      entity:          eng.entity,
      service:         eng.serviceCatalogue,
      owner,
      internalOwner:   eng.internalOwner,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/service-engagements/[id]')
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const eng = await prisma.serviceEngagement.findUnique({ where: { id: params.id } })
    if (!eng || eng.orgId !== session.orgId) throw new NotFoundError('Service engagement not found')

    const body = await req.json()
    const data: Record<string, unknown> = {}

    if (body.status        !== undefined) data.status        = body.status
    if (body.slaStatus     !== undefined) data.slaStatus     = body.slaStatus
    if (body.slaTarget     !== undefined) data.slaTarget     = body.slaTarget     ? sanitiseString(body.slaTarget)     : null
    if (body.department    !== undefined) data.department    = body.department    ? sanitiseString(body.department)    : null
    if (body.internalOwner !== undefined) data.internalOwner = body.internalOwner ?? null
    if (body.contractStart !== undefined) data.contractStart = body.contractStart ? new Date(body.contractStart)       : null
    if (body.contractEnd   !== undefined) data.contractEnd   = body.contractEnd   ? new Date(body.contractEnd)         : null
    if (body.notes         !== undefined) data.notes         = body.notes         ? sanitiseString(body.notes)         : null
    if (body.markReviewed)               data.lastReviewedAt = new Date()

    // complianceDocs must be a valid JSON array if provided
    if (body.complianceDocs !== undefined) {
      if (!Array.isArray(body.complianceDocs)) throw new ValidationError('complianceDocs must be an array')
      data.complianceDocs = body.complianceDocs
    }

    await prisma.serviceEngagement.update({ where: { id: params.id }, data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/service-engagements/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const eng = await prisma.serviceEngagement.findUnique({ where: { id: params.id } })
    if (!eng || eng.orgId !== session.orgId) throw new NotFoundError('Service engagement not found')

    await prisma.serviceEngagement.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/service-engagements/[id]')
  }
}
