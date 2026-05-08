// src/app/api/service-engagements/route.ts
// GET  — paginated list with optional status / slaStatus / category filters
// POST — create a new service engagement

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const page      = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize  = 50
    const status    = searchParams.get('status') ?? ''
    const slaStatus = searchParams.get('slaStatus') ?? ''

    const where = {
      orgId: session.orgId!,
      ...(status    ? { status:    status    as never } : {}),
      ...(slaStatus ? { slaStatus: slaStatus as never } : {}),
    }

    const [total, rows] = await Promise.all([
      prisma.serviceEngagement.count({ where }),
      prisma.serviceEngagement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
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

    return NextResponse.json({ engagements, total })
  } catch (err) {
    return handleApiError(err, 'GET /api/service-engagements')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const body = await req.json()
    const {
      entityId, serviceCatalogueId, contractId, internalOwner, department,
      status, slaTarget, slaStatus, contractStart, contractEnd,
      notes,
    } = body

    if (!entityId)           throw new ValidationError('entityId is required')
    if (!serviceCatalogueId) throw new ValidationError('serviceCatalogueId is required')
    if (!contractId)         throw new ValidationError('contractId is required — every service engagement must be backed by a contract')

    // Verify entity belongs to org
    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId! },
    })
    if (!entity) throw new ValidationError('Entity not found')

    // Verify catalogue entry exists and is active
    const catalogue = await prisma.serviceCatalogue.findUnique({ where: { id: serviceCatalogueId } })
    if (!catalogue || !catalogue.isActive) throw new ValidationError('Service catalogue entry not found or inactive')

    // Verify contract belongs to this org and entity
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, orgId: session.orgId!, entityId },
    })
    if (!contract) throw new ValidationError('Contract not found for this entity')

    // Enforce unique constraint gracefully
    const existing = await prisma.serviceEngagement.findFirst({
      where: { entityId, serviceCatalogueId, orgId: session.orgId! },
    })
    if (existing) throw new ValidationError('An engagement for this entity and service already exists')

    const engagement = await prisma.serviceEngagement.create({
      data: {
        entityId,
        serviceCatalogueId,
        orgId:          session.orgId!,
        contractId:     contractId,
        internalOwner:  internalOwner ?? null,
        department:     department    ? sanitiseString(department)  : null,
        status:         status        ?? 'ACTIVE',
        slaTarget:      slaTarget     ? sanitiseString(slaTarget)   : null,
        slaStatus:      slaStatus     ?? 'NOT_APPLICABLE',
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
