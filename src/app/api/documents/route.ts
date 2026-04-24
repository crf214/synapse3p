// src/app/api/documents/route.ts — GET (list)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const READ_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR', 'AP_CLERK'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const orgId    = session.orgId!
    const docType  = searchParams.get('docType')  ?? undefined
    const entityId = searchParams.get('entityId') ?? undefined
    const poId     = searchParams.get('poId')     ?? undefined
    const source   = searchParams.get('source')   ?? undefined
    const q        = searchParams.get('q')        ?? undefined
    const page     = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const limit    = 50

    const where: Record<string, unknown> = { orgId }
    if (docType)  where.docType  = docType
    if (entityId) where.entityId = entityId
    if (poId)     where.poId     = poId
    if (source)   where.source   = source
    if (q)        where.title    = { contains: q, mode: 'insensitive' }

    const [total, rows] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({
        where,
        skip:    (page - 1) * limit,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id:             true,
          title:          true,
          docType:        true,
          source:         true,
          storageRef:     true,
          mimeType:       true,
          fileSizeBytes:  true,
          entityId:       true,
          poId:           true,
          contractId:     true,
          status:         true,
          expiresAt:      true,
          issuedAt:       true,
          eSignRequired:  true,
          eSignStatus:    true,
          uploadedBy:     true,
          createdAt:      true,
        },
      }),
    ])

    // Batch-fetch entity names + uploader names
    const entityIds  = [...new Set(rows.map(r => r.entityId).filter(Boolean))] as string[]
    const uploaderIds= [...new Set(rows.map(r => r.uploadedBy))]

    const [entities, uploaders] = await Promise.all([
      entityIds.length > 0
        ? prisma.entity.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
        : [],
      uploaderIds.length > 0
        ? prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, email: true } })
        : [],
    ])

    const entityMap   = Object.fromEntries(entities.map(e => [e.id, e]))
    const uploaderMap = Object.fromEntries(uploaders.map(u => [u.id, u]))

    const documents = rows.map(r => ({
      ...r,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      issuedAt:  r.issuedAt?.toISOString()  ?? null,
      createdAt: r.createdAt.toISOString(),
      entity:    r.entityId ? entityMap[r.entityId] ?? null : null,
      uploader:  uploaderMap[r.uploadedBy] ?? null,
      hasFile:   !!r.storageRef,
    }))

    return NextResponse.json({ documents, total, page, limit })
  } catch (err) {
    return handleApiError(err, "")
  }
}
