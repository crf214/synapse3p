// src/app/api/external-signals/[id]/route.ts
// PUT — review or dismiss a signal

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const UpdateExternalSignalSchema = z.object({
  dismissed: z.boolean().optional(),
})

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

    const rawBody = await req.json()
    const parsed = UpdateExternalSignalSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data
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
