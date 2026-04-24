// src/app/api/invoices/recurring/route.ts — GET/POST recurring schedules

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

const VALID_FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const entityId = req.nextUrl.searchParams.get('entityId') || null

    const schedules = await prisma.recurringSchedule.findMany({
      where: {
        orgId: session.orgId,
        ...(entityId ? { entityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        entity: { select: { id: true, name: true, slug: true } },
      },
    })

    return NextResponse.json({ schedules })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices/recurring')
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const body = await req.json() as {
      entityId:       string
      name:           string
      description?:   string
      spendCategory?: string
      expectedAmount: number
      currency?:      string
      frequency:      string
      dayOfMonth?:    number
      toleranceFixed?: number
      tolerancePct?:  number
    }

    if (!body.entityId)        throw new ValidationError('entityId is required')
    if (!body.name?.trim())    throw new ValidationError('name is required')
    if (!body.expectedAmount || body.expectedAmount <= 0) throw new ValidationError('expectedAmount must be positive')
    if (!body.frequency || !VALID_FREQUENCIES.has(body.frequency.toUpperCase())) {
      throw new ValidationError(`frequency must be one of: ${[...VALID_FREQUENCIES].join(', ')}`)
    }

    const entity = await prisma.entity.findFirst({
      where: { id: body.entityId, masterOrgId: session.orgId },
    })
    if (!entity) throw new ValidationError('Entity not found')

    const schedule = await prisma.recurringSchedule.create({
      data: {
        orgId:          session.orgId,
        entityId:       body.entityId,
        name:           sanitiseString(body.name, 200),
        description:    body.description ? sanitiseString(body.description, 1000) : null,
        spendCategory:  body.spendCategory ? sanitiseString(body.spendCategory, 100) : null,
        expectedAmount: body.expectedAmount,
        currency:       body.currency ?? 'USD',
        frequency:      body.frequency.toUpperCase(),
        dayOfMonth:     body.dayOfMonth ?? null,
        toleranceFixed: body.toleranceFixed ?? 0,
        tolerancePct:   body.tolerancePct ?? 0.02,
        isActive:       true,
      },
      include: { entity: { select: { name: true, slug: true } } },
    })

    return NextResponse.json({ schedule }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/invoices/recurring')
  }
}
