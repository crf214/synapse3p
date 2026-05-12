// GET /api/audit-log — paginated, filterable audit event list
// Access: ADMIN, CFO, CONTROLLER, AUDITOR

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const page       = Math.max(1, parseInt(searchParams.get('page')       ?? '1'))
    const limit      = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')))
    const objectType = searchParams.get('objectType') ?? undefined
    const action     = searchParams.get('action')     ?? undefined
    const actorId    = searchParams.get('actorId')    ?? undefined
    const objectId   = searchParams.get('objectId')   ?? undefined
    const from       = searchParams.get('from')       ?? undefined
    const to         = searchParams.get('to')         ?? undefined

    const where: Record<string, unknown> = { orgId: session.orgId }
    if (objectType) where.entityType = objectType
    if (action)     where.action     = action
    if (actorId)    where.actorId    = actorId
    if (objectId)   where.entityId   = objectId
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to)   } : {}),
      }
    }

    const [total, events] = await Promise.all([
      prisma.auditEvent.count({ where }),
      prisma.auditEvent.findMany({
        where,
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    // Resolve actor names
    const actorIds = [...new Set(events.map(e => e.actorId).filter(Boolean))] as string[]
    const actors   = actorIds.length > 0
      ? await prisma.user.findMany({
          where:  { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const actorMap = Object.fromEntries(actors.map(u => [u.id, u]))

    const rows = events.map(e => ({
      id:         e.id,
      action:     e.action,
      objectType: e.entityType,
      objectId:   e.entityId,
      actorId:    e.actorId,
      actorName:  e.actorId ? (actorMap[e.actorId]?.name ?? actorMap[e.actorId]?.email ?? e.actorId) : null,
      before:     e.before,
      after:      e.after,
      ipAddress:  e.ipAddress,
      createdAt:  e.createdAt.toISOString(),
    }))

    return NextResponse.json({ events: rows, total, page, limit })
  } catch (err) {
    return handleApiError(err, 'GET /api/audit-log')
  }
}
