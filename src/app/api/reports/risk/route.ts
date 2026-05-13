import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getOrComputeSnapshot } from '@/lib/reporting/snapshots'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { APPROVAL_ROLES } from '@/lib/security/roles'

const ALLOWED_ROLES = APPROVAL_ROLES

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    const orgId = session.orgId
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const snapshot = await getOrComputeSnapshot(session.orgId, 'RISK_DASHBOARD', 60)

    return NextResponse.json({
      risk:        snapshot.data,
      isLive:      snapshot.isLive,
      snapshotAge: snapshot.snapshotAge,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/reports/risk')
  }
}
