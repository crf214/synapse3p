import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { runAllControls } from '@/lib/controls/ControlTestRunner'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const READ_ROLES  = new Set(['ADMIN', 'CFO', 'CONTROLLER', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN'])

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    // Fetch all controls with their latest test result
    const controls = await prisma.control.findMany({
      where:   { orgId: session.orgId },
      orderBy: { controlId: 'asc' },
      include: {
        testResults: {
          orderBy: { testedAt: 'desc' },
          take:    1,
          select: {
            id:         true,
            status:     true,
            summary:    true,
            testedAt:   true,
            testedBy:   true,
            reviewedBy: true,
          },
        },
      },
    })

    const data = controls.map(c => ({
      ...c,
      latestResult: c.testResults[0] ?? null,
      testResults:  undefined,
    }))

    return NextResponse.json({ controls: data, total: data.length })
  } catch (err) {
    return handleApiError(err, 'GET /api/controls')
  }
}

export async function POST() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const counts = await runAllControls(session.orgId)

    return NextResponse.json({ success: true, counts })
  } catch (err) {
    return handleApiError(err, 'POST /api/controls')
  }
}
