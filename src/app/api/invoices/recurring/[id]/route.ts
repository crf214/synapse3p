// src/app/api/invoices/recurring/[id]/route.ts — PUT/DELETE a recurring schedule

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { APPROVAL_ROLES } from '@/lib/security/roles'

const UpdateRecurringScheduleSchema = z.object({
  name:           z.string().optional(),
  description:    z.string().optional(),
  spendCategory:  z.string().optional(),
  expectedAmount: z.number().optional(),
  currency:       z.string().optional(),
  frequency:      z.string().optional(),
  dayOfMonth:     z.number().nullable().optional(),
  toleranceFixed: z.number().optional(),
  tolerancePct:   z.number().optional(),
  isActive:       z.boolean().optional(),
})

const WRITE_ROLES = APPROVAL_ROLES
const VALID_FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'])

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params
    const sched = await prisma.recurringSchedule.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!sched) throw new NotFoundError('Recurring schedule not found')

    const rawBody = await req.json()
    const parsed = UpdateRecurringScheduleSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

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
    return handleApiError(err, 'PUT /api/invoices/recurring/[id]')
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params
    const sched = await prisma.recurringSchedule.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!sched) throw new NotFoundError('Recurring schedule not found')

    // Soft-delete via isActive rather than hard delete (invoices may reference it)
    await prisma.recurringSchedule.update({
      where: { id: sched.id },
      data:  { isActive: false },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/invoices/recurring/[id]')
  }
}
