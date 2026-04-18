import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId },
      include: {
        classifications: { orderBy: { isPrimary: 'desc' } },
        bankAccounts:    { orderBy: { isPrimary: 'desc' } },
        dueDiligence:    true,
        financial:       true,
        riskScores: {
          orderBy: { scoredAt: 'desc' },
          take:    1,
        },
        orgRelationships: {
          where:  { orgId: session.orgId },
          take:   1,
        },
        serviceEngagements: {
          include: { serviceCatalogue: { select: { name: true, category: true } } },
          orderBy: { createdAt: 'desc' },
        },
        entityActivityLogs: {
          orderBy: { occurredAt: 'desc' },
          take:    10,
        },
        parent: { select: { id: true, name: true, slug: true } },
      },
    })

    if (!entity) throw new NotFoundError('Entity not found')

    return NextResponse.json({ entity })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]')
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const existing = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId },
    })
    if (!existing) throw new NotFoundError('Entity not found')

    const body = await req.json() as Record<string, unknown>

    const ALLOWED = ['name', 'jurisdiction', 'registrationNo', 'incorporationDate',
                     'status', 'primaryCurrency', 'riskScore', 'riskOverride', 'parentId']
    const updates: Record<string, unknown> = {}

    for (const key of ALLOWED) {
      if (!(key in body)) continue
      if (key === 'name' || key === 'jurisdiction' || key === 'registrationNo' || key === 'primaryCurrency') {
        const v = sanitiseString(body[key] ?? '', 200)
        if (key === 'name' && !v) throw new ValidationError('name cannot be empty')
        updates[key] = v || null
      } else if (key === 'incorporationDate') {
        updates[key] = body[key] ? new Date(body[key] as string) : null
      } else if (key === 'riskScore') {
        const n = parseFloat(String(body[key]))
        if (!isNaN(n)) updates[key] = n
      } else if (key === 'riskOverride') {
        updates[key] = Boolean(body[key])
      } else {
        updates[key] = body[key]
      }
    }

    const entity = await prisma.entity.update({
      where: { id: entityId },
      data:  updates,
    })

    return NextResponse.json({ entity })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/entities/[entityId]')
  }
}
