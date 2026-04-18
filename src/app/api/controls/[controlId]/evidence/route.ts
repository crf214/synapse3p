import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'

const READ_ROLES  = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER'])

export async function GET(
  _req: Request,
  { params }: { params: { controlId: string } },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const control = await prisma.control.findFirst({
      where: { id: params.controlId, orgId: session.orgId },
    })
    if (!control) throw new NotFoundError('Control not found')

    const evidence = await prisma.controlEvidence.findMany({
      where:   { controlId: params.controlId, orgId: session.orgId },
      orderBy: { collectedAt: 'desc' },
    })

    return NextResponse.json({ evidence, total: evidence.length })
  } catch (err) {
    return handleApiError(err, `GET /api/controls/${params.controlId}/evidence`)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { controlId: string } },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const control = await prisma.control.findFirst({
      where: { id: params.controlId, orgId: session.orgId },
    })
    if (!control) throw new NotFoundError('Control not found')

    const body = await req.json() as Record<string, unknown>

    const title        = sanitiseString(body.title ?? '', 200)
    const evidenceType = sanitiseString(body.evidenceType ?? '', 50)
    const description  = body.description ? sanitiseString(body.description, 1000) : undefined
    const storageRef   = body.storageRef  ? sanitiseString(body.storageRef, 500)  : undefined
    const storageHash  = body.storageHash ? sanitiseString(body.storageHash, 64)  : undefined
    const auditPeriodId = body.auditPeriodId ? sanitiseString(body.auditPeriodId, 30) : undefined

    if (!title)        throw new ValidationError('title is required')
    if (!evidenceType) throw new ValidationError('evidenceType is required')

    const VALID_TYPES = new Set(['AUTOMATED_TEST', 'MANUAL_REVIEW', 'DOCUMENT', 'SCREENSHOT', 'EXPORT', 'SIGN_OFF'])
    if (!VALID_TYPES.has(evidenceType)) {
      throw new ValidationError(`Invalid evidenceType. Must be one of: ${[...VALID_TYPES].join(', ')}`)
    }

    const record = await prisma.controlEvidence.create({
      data: {
        controlId:    params.controlId,
        orgId:        session.orgId,
        auditPeriodId: auditPeriodId ?? null,
        evidenceType: evidenceType as Parameters<typeof prisma.controlEvidence.create>[0]['data']['evidenceType'],
        title,
        description,
        storageRef,
        storageHash,
        collectedBy:  session.userId,
        metadata:     (body.metadata as object) ?? {},
      },
    })

    return NextResponse.json({ evidence: record }, { status: 201 })
  } catch (err) {
    return handleApiError(err, `POST /api/controls/${params.controlId}/evidence`)
  }
}
