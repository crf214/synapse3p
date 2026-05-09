// src/app/api/bcdr/route.ts
// GET  — paginated list of BC/DR records with optional type/status filters
// POST — create a new record

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const CreateBcDrRecordSchema = z.object({
  recordType:     z.string().min(1),
  status:         z.string().min(1),
  description:    z.string().min(1),
  testedAt:       z.string().optional(),
  rtoTargetHours: z.number().optional(),
  rpoTargetHours: z.number().optional(),
  actualRtoHours: z.number().nullable().optional(),
  actualRpoHours: z.number().nullable().optional(),
  notes:          z.string().optional(),
})

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'CISO', 'AUDITOR'])
const WRITE_ROLES   = new Set(['ADMIN', 'CISO', 'CONTROLLER'])

const VALID_TYPES   = ['BACKUP_VERIFICATION', 'RTO_TEST', 'RPO_TEST', 'INCIDENT', 'RECOVERY'] as const
const VALID_RESULTS = ['PASS', 'FAIL', 'WARNING', 'NOT_RUN', 'ERROR'] as const

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const page       = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize   = 50
    const recordType = searchParams.get('type')   ?? ''
    const status     = searchParams.get('status') ?? ''

    const where = {
      orgId: session.orgId!,
      ...(recordType ? { recordType }                          : {}),
      ...(status     ? { status: status as never }             : {}),
    }

    const [total, rows] = await Promise.all([
      prisma.bcDrRecord.count({ where }),
      prisma.bcDrRecord.findMany({
        where,
        orderBy: { testedAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
      }),
    ])

    // Batch-resolve tester names
    const testerIds = new Set(rows.map(r => r.testedBy))
    const testers = testerIds.size > 0
      ? await prisma.user.findMany({
          where:  { id: { in: [...testerIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const testerMap = Object.fromEntries(testers.map(u => [u.id, u]))

    return NextResponse.json({
      records: rows.map(r => ({
        id:             r.id,
        recordType:     r.recordType,
        status:         r.status,
        description:    r.description,
        rtoTargetHours: r.rtoTargetHours,
        rpoTargetHours: r.rpoTargetHours,
        actualRtoHours: r.actualRtoHours,
        actualRpoHours: r.actualRpoHours,
        testedAt:       r.testedAt.toISOString(),
        notes:          r.notes,
        evidence:       r.evidence,
        tester:         testerMap[r.testedBy] ?? null,
      })),
      total,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/bcdr')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!WRITE_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rawBody = await req.json()
    const parsed = CreateBcDrRecordSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const {
      recordType, status, description, testedAt,
      rtoTargetHours, rpoTargetHours, actualRtoHours, actualRpoHours,
      notes,
    } = parsed.data

    if (!VALID_TYPES.includes(recordType as never))   throw new ValidationError(`recordType must be one of: ${VALID_TYPES.join(', ')}`)
    if (!VALID_RESULTS.includes(status as never))     throw new ValidationError(`status must be one of: ${VALID_RESULTS.join(', ')}`)

    const record = await prisma.bcDrRecord.create({
      data: {
        orgId:          session.orgId!,
        recordType: recordType as never,
        status:     status     as never,
        description:    sanitiseString(description),
        testedAt:       testedAt ? new Date(testedAt) : new Date(),
        testedBy:       session.userId,
        rtoTargetHours: rtoTargetHours != null ? Number(rtoTargetHours) : 8,
        rpoTargetHours: rpoTargetHours != null ? Number(rpoTargetHours) : 24,
        actualRtoHours: actualRtoHours != null ? Number(actualRtoHours) : null,
        actualRpoHours: actualRpoHours != null ? Number(actualRpoHours) : null,
        notes:          notes ? sanitiseString(notes) : null,
        evidence:       [],
      },
    })

    return NextResponse.json({ id: record.id }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/bcdr')
  }
}
