import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { runFullSync, syncVendors, syncTransactions, syncPeriods } from '@/lib/erp/ErpSyncService'

// POST /api/erp/sync          — run a full sync (all three phases)
// POST /api/erp/sync?type=vendors|transactions|periods  — run a single phase

export async function POST(request: Request) {
  const session = await getSession()

  if (!session.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (session.role !== 'ADMIN' && session.role !== 'COMPLIANCE') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const orgId = session.orgId
  if (!orgId) {
    return NextResponse.json({ error: 'No organisation in session' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')

  try {
    if (!type || type === 'full') {
      await runFullSync(orgId, session.userId)
      return NextResponse.json({ ok: true, type: 'full' })
    }

    if (type === 'vendors') {
      const result = await syncVendors(orgId, session.userId)
      return NextResponse.json({ ok: true, type: 'vendors', result })
    }

    if (type === 'transactions') {
      let since: Date | undefined
      const sinceParam = searchParams.get('since')
      if (sinceParam) {
        since = new Date(sinceParam)
        if (isNaN(since.getTime())) {
          return NextResponse.json({ error: 'Invalid since date' }, { status: 400 })
        }
      }
      const result = await syncTransactions(orgId, session.userId, since)
      return NextResponse.json({ ok: true, type: 'transactions', result })
    }

    if (type === 'periods') {
      const result = await syncPeriods(orgId, session.userId)
      return NextResponse.json({ ok: true, type: 'periods', result })
    }

    return NextResponse.json({ error: `Unknown sync type: ${type}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
