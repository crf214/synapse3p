// src/app/api/service-engagements/route.ts
// GET  — paginated list with optional status / slaStatus / category filters
// POST — create a new service engagement

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateServiceEngagementSchema = z.object({
  entityId:           z.string().min(1),
  serviceCatalogueId: z.string().min(1),
  contractId:         z.string().min(1),
  internalOwner:      z.string().optional().nullable(),
  department:         z.string().optional().nullable(),
  status:             z.string().optional(),
  slaTarget:          z.string().optional().nullable(),
  slaStatus:          z.string().optional(),
  contractStart:      z.string().optional().nullable(),
  contractEnd:        z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
})

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const orgId = session.orgId

    const { searchParams } = new URL(req.url)
    const page      = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const limit     = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))
    const status    = searchParams.get('status') ?? ''
    const slaStatus = searchParams.get('slaStatus') ?? ''

    const where = {
      orgId,
      ...(status    ? { status:    status    as never } : {}),
      ...(slaStatus ? { slaStatus: slaStatus as never } : {}),
    }

    const [total, rows] = await Promise.all([
      prisma.serviceEngagement.count({ where }),
      prisma.serviceEngagement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          entity:          { select: { id: true, name: true } },
          serviceCatalogue: { select: { id: true, name: true, parentId: true } },
        },
      }),
    ])

    // Batch-resolve owner names
    const ownerIds = new Set(rows.map(r => r.internalOwner).filter(Boolean) as string[])
    const owners = ownerIds.size > 0
      ? await prisma.user.findMany({
          where:  { id: { in: [...ownerIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const ownerMap = Object.fromEntries(owners.map(u => [u.id, u]))

    const engagements = rows.map(r => ({
      id:              r.id,
      status:          r.status,
      slaStatus:       r.slaStatus,
      slaTarget:       r.slaTarget,
      department:      r.department,
      contractStart:   r.contractStart?.toISOString() ?? null,
      contractEnd:     r.contractEnd?.toISOString() ?? null,
      lastReviewedAt:  r.lastReviewedAt?.toISOString() ?? null,
      createdAt:       r.createdAt.toISOString(),
      entity:          r.entity,
      service:         r.serviceCatalogue,
      owner:           r.internalOwner ? (ownerMap[r.internalOwner] ?? null) : null,
    }))

    return NextResponse.json({
      data:       engagements,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/service-engagements')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!session.orgId)  throw new UnauthorizedError('No organisation associated with this session')
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const orgId = session.orgId

    const rawBody = await req.json()
    const parsed = CreateServiceEngagementSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const {
      entityId, serviceCatalogueId, contractId, internalOwner, department,
      status, slaTarget, slaStatus, contractStart, contractEnd,
      notes,
    } = parsed.data

    // Verify entity belongs to org
    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: orgId },
    })
    if (!entity) throw new ValidationError('Entity not found')

    // Verify catalogue entry exists and is active
    const catalogue = await prisma.serviceCatalogue.findUnique({ where: { id: serviceCatalogueId } })
    if (!catalogue || !catalogue.isActive) throw new ValidationError('Service catalogue entry not found or inactive')

    // Verify contract belongs to this org and entity
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, orgId, entityId },
    })
    if (!contract) throw new ValidationError('Contract not found for this entity')

    // Enforce unique constraint gracefully
    const existing = await prisma.serviceEngagement.findFirst({
      where: { entityId, serviceCatalogueId, orgId },
    })
    if (existing) throw new ValidationError('An engagement for this entity and service already exists')

    const engagement = await prisma.serviceEngagement.create({
      data: {
        entityId,
        serviceCatalogueId,
        orgId,
        contractId:     contractId,
        internalOwner:  internalOwner ?? null,
        department:     department    ? sanitiseString(department)  : null,
        status:         (status        ?? 'ACTIVE') as never,
        slaTarget:      slaTarget     ? sanitiseString(slaTarget)   : null,
        slaStatus:      (slaStatus     ?? 'NOT_APPLICABLE') as never,
        contractStart:  contractStart ? new Date(contractStart)     : null,
        contractEnd:    contractEnd   ? new Date(contractEnd)       : null,
        notes:          notes         ? sanitiseString(notes)       : null,
      },
    })

    return NextResponse.json({ id: engagement.id }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/service-engagements')
  }
}
