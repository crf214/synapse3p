import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { runControl } from '@/lib/controls/ControlTestRunner'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'CFO', 'CONTROLLER'])

export async function POST(
  _req: Request,
  { params }: { params: { controlId: string } },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const control = await prisma.control.findFirst({
      where: { id: params.controlId, orgId: session.orgId },
      select: { automatedTestKey: true, controlId: true },
    })
    if (!control) throw new NotFoundError('Control not found')
    if (!control.automatedTestKey) {
      return NextResponse.json(
        { error: `Control ${control.controlId} has no automated test — manual attestation required` },
        { status: 422 },
      )
    }

    const result = await runControl(session.orgId, control.automatedTestKey)

    return NextResponse.json({ result })
  } catch (err) {
    return handleApiError(err, `POST /api/controls/${params.controlId}/run`)
  }
}
