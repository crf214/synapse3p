// src/app/api/external-signals/configs/[id]/route.ts
// PUT    — update config (ADMIN/CISO)
// DELETE — remove config (ADMIN/CISO)

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const UpdateSignalConfigSchema = z.object({
  isActive:          z.boolean().optional(),
  companyName:       z.string().optional(),
  stockTicker:       z.string().nullable().optional(),
  alertRecipients:   z.array(z.string()).optional(),
  newsKeywords:      z.array(z.string()).optional(),
  signalTypes:       z.array(z.string()).optional(),
  severityThreshold: z.string().optional(),
})

const WRITE_ROLES = new Set(['ADMIN', 'CISO'])
const VALID_TYPES = ['NEWS', 'STOCK_PRICE'] as const
const VALID_SEV   = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const config = await prisma.externalSignalConfig.findUnique({ where: { id } })
    if (!config || config.orgId !== session.orgId) throw new NotFoundError('Config not found')

    const rawBody = await req.json()
    const parsed = UpdateSignalConfigSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data
    const data: Record<string, unknown> = {}

    if (body.isActive          !== undefined) data.isActive          = Boolean(body.isActive)
    if (body.companyName       !== undefined) data.companyName       = sanitiseString(body.companyName)
    if (body.stockTicker       !== undefined) data.stockTicker       = body.stockTicker ? sanitiseString(body.stockTicker).toUpperCase() : null
    if (body.alertRecipients   !== undefined) data.alertRecipients   = body.alertRecipients
    if (body.newsKeywords      !== undefined) data.newsKeywords      = body.newsKeywords.map((k: string) => sanitiseString(k))

    if (body.signalTypes !== undefined) {
      for (const t of body.signalTypes) {
        if (!VALID_TYPES.includes(t as never)) throw new ValidationError('Invalid signal type')
      }
      data.signalTypes = body.signalTypes
    }
    if (body.severityThreshold !== undefined) {
      if (!VALID_SEV.includes(body.severityThreshold as never)) throw new ValidationError('Invalid severity threshold')
      data.severityThreshold = body.severityThreshold
    }

    await prisma.externalSignalConfig.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/external-signals/configs/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const config = await prisma.externalSignalConfig.findUnique({ where: { id } })
    if (!config || config.orgId !== session.orgId) throw new NotFoundError('Config not found')

    await prisma.externalSignalConfig.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/external-signals/configs/[id]')
  }
}
