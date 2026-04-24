// src/app/api/external-signals/configs/[id]/route.ts
// PUT    — update config (ADMIN/CISO)
// DELETE — remove config (ADMIN/CISO)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const WRITE_ROLES = new Set(['ADMIN', 'CISO'])
const VALID_TYPES = ['NEWS', 'STOCK_PRICE'] as const
const VALID_SEV   = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

type Params = { params: { id: string } }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const config = await prisma.externalSignalConfig.findUnique({ where: { id: params.id } })
    if (!config || config.orgId !== session.orgId) throw new NotFoundError('Config not found')

    const body = await req.json()
    const data: Record<string, unknown> = {}

    if (body.isActive          !== undefined) data.isActive          = Boolean(body.isActive)
    if (body.companyName       !== undefined) data.companyName       = sanitiseString(body.companyName)
    if (body.stockTicker       !== undefined) data.stockTicker       = body.stockTicker ? sanitiseString(body.stockTicker).toUpperCase() : null
    if (body.alertRecipients   !== undefined) data.alertRecipients   = Array.isArray(body.alertRecipients) ? body.alertRecipients : []
    if (body.newsKeywords      !== undefined) data.newsKeywords      = Array.isArray(body.newsKeywords) ? body.newsKeywords.map((k: string) => sanitiseString(k)) : []

    if (body.signalTypes !== undefined) {
      const types = body.signalTypes as string[]
      for (const t of types) {
        if (!VALID_TYPES.includes(t as never)) throw new ValidationError('Invalid signal type')
      }
      data.signalTypes = types
    }
    if (body.severityThreshold !== undefined) {
      if (!VALID_SEV.includes(body.severityThreshold)) throw new ValidationError('Invalid severity threshold')
      data.severityThreshold = body.severityThreshold
    }

    await prisma.externalSignalConfig.update({ where: { id: params.id }, data })
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

    const config = await prisma.externalSignalConfig.findUnique({ where: { id: params.id } })
    if (!config || config.orgId !== session.orgId) throw new NotFoundError('Config not found')

    await prisma.externalSignalConfig.delete({ where: { id: params.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/external-signals/configs/[id]')
  }
}
