// src/app/api/portal/documents/route.ts
// GET — documents linked to the portal user's entity

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const PORTAL_ROLES = new Set(['VENDOR', 'CLIENT'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rel = await prisma.entityOrgRelationship.findFirst({
      where: { portalUserId: session.userId },
    })
    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    const { searchParams } = new URL(req.url)
    const page     = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize = 20

    const where = {
      entityId: rel.entityId,
      orgId:    rel.orgId,
      status:   { not: 'deleted' as never },
    }

    const [total, documents] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, title: true, docType: true, status: true,
          eSignStatus: true, expiresAt: true, createdAt: true,
        },
      }),
    ])

    return NextResponse.json({
      documents: documents.map(d => ({
        id:          d.id,
        title:       d.title,
        docType:     d.docType,
        status:      d.status,
        eSignStatus: d.eSignStatus,
        expiresAt:   d.expiresAt?.toISOString()  ?? null,
        createdAt:   d.createdAt.toISOString(),
      })),
      total,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/portal/documents')
  }
}
