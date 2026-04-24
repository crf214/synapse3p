// src/app/api/invoices/recurring/[id]/route.ts — PUT/DELETE a recurring schedule

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const WRITE_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const VALID_FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'])

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const sched = await prisma.recurringSchedule.findFirst({
      where: { id: params.id, orgId: session.orgId },
    })
    if (!sched) throw new NotFoundError('Recurring schedule not found')

    const body = await req.json() as {
      name?:          string
      description?:   string
      spendCategory?: string
      expectedAmount?: number
      currency?:      string
      frequency?:     string
      dayOfMonth?:    number | null
      toleranceFixed?: number
      tolerancePct?:  number
      isActive?:      boolean
    }

    if (body.frequency && !VALID_FREQUENCIES.has(body.frequency.toUpperCase())) {
      throw new ValidationError(`frequency must be one of: ${[...VALID_FREQUENCIES].join(', ')}`)
    }
    if (body.expectedAmount !== undefined && body.expectedAmount <= 0) {
      throw new ValidationError('expectedAmount must be positive')
    }

    const updated = await prisma.recurringSchedule.update({
      where: { id: sched.id },
      data:  {
        ...(body.name           !== undefined ? { name:           sanitiseString(body.name, 200) } : {}),
        ...(body.description    !== undefined ? { description:    sanitiseString(body.description, 1000) } : {}),
        ...(body.spendCategory  !== undefined ? { spendCategory:  sanitiseString(body.spendCategory, 100) } : {}),
        ...(body.expectedAmount !== undefined ? { expectedAmount: body.expectedAmount } : {}),
        ...(body.currency       !== undefined ? { currency:       body.currency } : {}),
        ...(body.frequency      !== undefined ? { frequency:      body.frequency.toUpperCase() } : {}),
        ...(body.dayOfMonth     !== undefined ? { dayOfMonth:     body.dayOfMonth } : {}),
        ...(body.toleranceFixed !== undefined ? { toleranceFixed: body.toleranceFixed } : {}),
        ...(body.tolerancePct   !== undefined ? { tolerancePct:   body.tolerancePct } : {}),
        ...(body.isActive       !== undefined ? { isActive:       body.isActive } : {}),
      },
      include: { entity: { select: { name: true } } },
    })

    return NextResponse.json({ schedule: updated })
  } catch (err) {
    return handleApiError(err, `PUT /api/invoices/recurring/${params.id}`)
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const sched = await prisma.recurringSchedule.findFirst({
      where: { id: params.id, orgId: session.orgId },
    })
    if (!sched) throw new NotFoundError('Recurring schedule not found')

    // Soft-delete via isActive rather than hard delete (invoices may reference it)
    await prisma.recurringSchedule.update({
      where: { id: sched.id },
      data:  { isActive: false },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, `DELETE /api/invoices/recurring/${params.id}`)
  }
}
