// src/app/api/bcdr/[id]/route.ts
// GET    — single record
// PUT    — update (WRITE_ROLES only)
// DELETE — delete (ADMIN/CISO only)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CISO', 'CONTROLLER'])
const VALID_RESULTS = ['PASS', 'FAIL', 'WARNING', 'NOT_RUN', 'ERROR'] as const

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const record = await prisma.bcDrRecord.findUnique({ where: { id } })
    if (!record || record.orgId !== session.orgId) throw new NotFoundError('BC/DR record not found')

    const tester = await prisma.user.findUnique({
      where:  { id: record.testedBy },
      select: { id: true, name: true, email: true },
    })

    return NextResponse.json({
      id:             record.id,
      recordType:     record.recordType,
      status:         record.status,
      description:    record.description,
      rtoTargetHours: record.rtoTargetHours,
      rpoTargetHours: record.rpoTargetHours,
      actualRtoHours: record.actualRtoHours,
      actualRpoHours: record.actualRpoHours,
      testedAt:       record.testedAt.toISOString(),
      notes:          record.notes,
      evidence:       record.evidence,
      tester,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/bcdr/[id]')
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const record = await prisma.bcDrRecord.findUnique({ where: { id } })
    if (!record || record.orgId !== session.orgId) throw new NotFoundError('BC/DR record not found')

    const body = await req.json()
    const data: Record<string, unknown> = {}

    if (body.status !== undefined) {
      if (!VALID_RESULTS.includes(body.status)) throw new ValidationError('Invalid status')
      data.status = body.status
    }
    if (body.description    !== undefined) data.description    = sanitiseString(body.description)
    if (body.notes          !== undefined) data.notes          = body.notes ? sanitiseString(body.notes) : null
    if (body.testedAt       !== undefined) data.testedAt       = new Date(body.testedAt)
    if (body.rtoTargetHours !== undefined) data.rtoTargetHours = Number(body.rtoTargetHours)
    if (body.rpoTargetHours !== undefined) data.rpoTargetHours = Number(body.rpoTargetHours)
    if (body.actualRtoHours !== undefined) data.actualRtoHours = body.actualRtoHours != null ? Number(body.actualRtoHours) : null
    if (body.actualRpoHours !== undefined) data.actualRpoHours = body.actualRpoHours != null ? Number(body.actualRpoHours) : null
    if (body.evidence       !== undefined) {
      if (!Array.isArray(body.evidence)) throw new ValidationError('evidence must be an array')
      data.evidence = body.evidence
    }

    await prisma.bcDrRecord.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/bcdr/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!new Set(['ADMIN', 'CISO']).has(session.role ?? '')) throw new ForbiddenError()

    const { id } = await params
    const record = await prisma.bcDrRecord.findUnique({ where: { id } })
    if (!record || record.orgId !== session.orgId) throw new NotFoundError('BC/DR record not found')

    await prisma.bcDrRecord.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/bcdr/[id]')
  }
}
