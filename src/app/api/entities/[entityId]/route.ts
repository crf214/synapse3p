import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const LEGAL_STRUCTURES = new Set(['INDIVIDUAL', 'COMPANY', 'FUND', 'TRUST', 'GOVERNMENT', 'OTHER'])
const ENTITY_STATUSES  = new Set(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_REVIEW', 'OFFBOARDED'])

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
          include: { serviceCatalogue: { select: { name: true, parentId: true } } },
          orderBy: { createdAt: 'desc' },
        },
        entityActivityLogs: {
          orderBy: { occurredAt: 'desc' },
          take:    100,
        },
        parent:        { select: { id: true, name: true, slug: true } },
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
    const updates: Record<string, unknown> = {}
    const changedFields: string[] = []

    // ── String fields ────────────────────────────────────────────────────────
    for (const key of ['name', 'jurisdiction', 'registrationNo', 'primaryCurrency', 'stockTicker'] as const) {
      if (!(key in body)) continue
      const v = sanitiseString(body[key] ?? '', 200)
      if (key === 'name' && !v) throw new ValidationError('name cannot be empty')
      const next = v || null
      if (String(existing[key] ?? '') !== String(next ?? '')) {
        updates[key] = next
        changedFields.push(key)
      }
    }

    // ── Date field ───────────────────────────────────────────────────────────
    if ('incorporationDate' in body) {
      const next = body.incorporationDate ? new Date(body.incorporationDate as string) : null
      const prev = existing.incorporationDate?.toISOString().slice(0, 10) ?? null
      const nextStr = next?.toISOString().slice(0, 10) ?? null
      if (prev !== nextStr) {
        updates.incorporationDate = next
        changedFields.push('incorporationDate')
      }
    }

    // ── Enum fields ──────────────────────────────────────────────────────────
    if ('legalStructure' in body) {
      const v = String(body.legalStructure ?? '').toUpperCase()
      if (!LEGAL_STRUCTURES.has(v)) throw new ValidationError('Invalid legalStructure')
      if (existing.legalStructure !== v) {
        updates.legalStructure = v
        changedFields.push('legalStructure')
      }
    }

    if ('status' in body) {
      const v = String(body.status ?? '').toUpperCase()
      if (!ENTITY_STATUSES.has(v)) throw new ValidationError('Invalid status')
      if (existing.status !== v) {
        updates.status = v
        changedFields.push('status')
      }
    }

    // ── Relation field (parentId) ────────────────────────────────────────────
    for (const key of ['parentId'] as const) {
      if (!(key in body)) continue
      const next = body[key] ? String(body[key]) : null
      if (next && next !== entityId) {
        // Verify the referenced entity belongs to same org
        const ref = await prisma.entity.findFirst({ where: { id: next, masterOrgId: session.orgId } })
        if (!ref) throw new ValidationError(`Referenced entity for ${key} not found`)
      }
      if ((existing[key] ?? null) !== next) {
        updates[key] = next
        changedFields.push(key)
      }
    }

    // ── Numeric / boolean overrides ──────────────────────────────────────────
    if ('riskOverride' in body) {
      const next = Boolean(body.riskOverride)
      if (existing.riskOverride !== next) {
        updates.riskOverride = next
        changedFields.push('riskOverride')
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ entity: existing })
    }

    const entity = await prisma.entity.update({
      where: { id: entityId },
      data:  updates,
    })

    // ── Activity log ─────────────────────────────────────────────────────────
    const FIELD_LABEL: Record<string, string> = {
      name: 'Legal name', jurisdiction: 'Jurisdiction', registrationNo: 'Registration No.',
      incorporationDate: 'Incorporation date', legalStructure: 'Legal structure',
      primaryCurrency: 'Primary currency', status: 'Status',
      stockTicker: 'Stock ticker', parentId: 'Parent entity',
      riskOverride: 'Risk override',
    }
    const fieldList = changedFields.map(f => FIELD_LABEL[f] ?? f).join(', ')

    await prisma.entityActivityLog.create({
      data: {
        entityId,
        orgId:        session.orgId,
        activityType: changedFields.includes('status') ? 'STATUS_CHANGE' : 'NOTE',
        title:        `Entity details updated`,
        description:  `Updated: ${fieldList}`,
        performedBy:  session.name ?? session.email ?? session.userId,
        occurredAt:   new Date(),
      },
    })

    return NextResponse.json({ entity })
  } catch (err) {
    return handleApiError(err, 'PATCH /api/entities/[entityId]')
  }
}
