// src/app/api/documents/[id]/route.ts — GET (detail) + DELETE

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const READ_ROLES   = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'LEGAL', 'CISO', 'AUDITOR', 'AP_CLERK'])
const DELETE_ROLES = new Set(['ADMIN', 'CFO', 'LEGAL'])

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!READ_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const doc = await prisma.document.findUnique({ where: { id } })
    if (!doc || doc.orgId !== session.orgId) throw new NotFoundError('Document not found')

    const [entity, uploader] = await Promise.all([
      doc.entityId ? prisma.entity.findUnique({ where: { id: doc.entityId }, select: { id: true, name: true } }) : null,
      prisma.user.findUnique({ where: { id: doc.uploadedBy }, select: { id: true, name: true, email: true } }),
    ])

    return NextResponse.json({
      ...doc,
      expiresAt:       doc.expiresAt?.toISOString()       ?? null,
      issuedAt:        doc.issuedAt?.toISOString()         ?? null,
      eSignCompletedAt:doc.eSignCompletedAt?.toISOString() ?? null,
      createdAt:       doc.createdAt.toISOString(),
      updatedAt:       doc.updatedAt.toISOString(),
      entity,
      uploader,
      hasFile: !!doc.storageRef,
    })
  } catch (err) {
    return handleApiError(err, "")
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!DELETE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const doc = await prisma.document.findUnique({ where: { id } })
    if (!doc || doc.orgId !== session.orgId) throw new NotFoundError('Document not found')

    // Soft-delete: mark as inactive rather than hard delete to preserve audit trail
    await prisma.document.update({ where: { id }, data: { status: 'deleted' } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, "")
  }
}
