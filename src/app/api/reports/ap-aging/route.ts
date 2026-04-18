import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getOrComputeSnapshot } from '@/lib/reporting/snapshots'
import { getPaymentQueueData } from '@/lib/reporting/queries'
import { handleApiError, UnauthorizedError } from '@/lib/errors'

export async function GET() {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()

    const { orgId } = session

    const [snapshot, paymentQueue] = await Promise.all([
      getOrComputeSnapshot(orgId, 'AP_AGING', 30),
      getPaymentQueueData(orgId),
    ])

    return NextResponse.json({
      apAging:     snapshot.data,
      paymentQueue,
      isLive:      snapshot.isLive,
      snapshotAge: snapshot.snapshotAge,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/reports/ap-aging')
  }
}
