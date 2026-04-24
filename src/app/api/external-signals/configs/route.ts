// src/app/api/external-signals/configs/route.ts
// GET  — list all signal configs for the org
// POST — create a config for an entity (ADMIN/CISO only)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'CISO', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CISO'])
const VALID_TYPES   = ['NEWS', 'STOCK_PRICE'] as const
const VALID_SEV     = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const configs = await prisma.externalSignalConfig.findMany({
      where:   { orgId: session.orgId! },
      orderBy: { createdAt: 'desc' },
      include: { entity: { select: { id: true, name: true } } },
    })

    // Batch-resolve alert recipient names
    const recipientIds = new Set<string>()
    for (const c of configs) for (const r of c.alertRecipients) recipientIds.add(r)
    const recipients = recipientIds.size > 0
      ? await prisma.user.findMany({
          where:  { id: { in: [...recipientIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const recipMap = Object.fromEntries(recipients.map(u => [u.id, u]))

    return NextResponse.json({
      configs: configs.map(c => ({
        id:                c.id,
        isActive:          c.isActive,
        signalTypes:       c.signalTypes,
        stockTicker:       c.stockTicker,
        companyName:       c.companyName,
        newsKeywords:      c.newsKeywords,
        severityThreshold: c.severityThreshold,
        alertRecipients:   c.alertRecipients.map(id => recipMap[id] ?? { id, name: null, email: id }),
        createdAt:         c.createdAt.toISOString(),
        updatedAt:         c.updatedAt.toISOString(),
        entity:            c.entity,
      })),
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/external-signals/configs')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const body = await req.json()
    const {
      entityId, signalTypes, stockTicker, companyName,
      newsKeywords, severityThreshold, alertRecipients,
    } = body

    if (!entityId)       throw new ValidationError('entityId is required')
    if (!companyName?.trim()) throw new ValidationError('companyName is required')

    const types = (signalTypes ?? []) as string[]
    for (const t of types) {
      if (!VALID_TYPES.includes(t as never)) throw new ValidationError(`signalTypes must be NEWS or STOCK_PRICE`)
    }
    if (severityThreshold && !VALID_SEV.includes(severityThreshold)) {
      throw new ValidationError(`severityThreshold must be LOW, MEDIUM, HIGH, or CRITICAL`)
    }

    const entity = await prisma.entity.findFirst({
      where: { id: entityId, masterOrgId: session.orgId! },
    })
    if (!entity) throw new ValidationError('Entity not found')

    const existing = await prisma.externalSignalConfig.findFirst({
      where: { entityId, orgId: session.orgId! },
    })
    if (existing) throw new ValidationError('A signal config for this entity already exists')

    const config = await prisma.externalSignalConfig.create({
      data: {
        entityId,
        orgId:             session.orgId!,
        companyName:       sanitiseString(companyName),
        signalTypes:       types as never[],
        stockTicker:       stockTicker ? sanitiseString(stockTicker).toUpperCase() : null,
        newsKeywords:      Array.isArray(newsKeywords) ? newsKeywords.map((k: string) => sanitiseString(k)) : [],
        severityThreshold: severityThreshold ?? 'MEDIUM',
        alertRecipients:   Array.isArray(alertRecipients) ? alertRecipients : [],
        isActive:          true,
      },
    })

    return NextResponse.json({ id: config.id }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/external-signals/configs')
  }
}
