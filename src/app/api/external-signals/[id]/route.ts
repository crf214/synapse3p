// src/app/api/external-signals/[id]/route.ts
// PUT — review or dismiss a signal

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'CISO', 'CONTROLLER', 'CFO'])

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const signal = await prisma.externalSignal.findUnique({ where: { id } })
    if (!signal || signal.orgId !== session.orgId) throw new NotFoundError('Signal not found')

    const body = await req.json()
    const data: Record<string, unknown> = {}

    if (body.dismissed !== undefined) {
      data.dismissed  = Boolean(body.dismissed)
      data.reviewedBy = session.userId
      data.reviewedAt = new Date()
    }

    await prisma.externalSignal.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/external-signals/[id]')
  }
}
