import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getOrComputeSnapshot } from '@/lib/reporting/snapshots'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const snapshot = await getOrComputeSnapshot(session.orgId, 'WORKLOAD', 30)

    return NextResponse.json({
      workload: snapshot.data,
      isLive:   snapshot.isLive,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/reports/workload')
  }
}
