import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

// GET /api/erp/sync-logs?limit=20&offset=0

export async function GET(request: Request) {
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
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '20', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  const [logs, total] = await Promise.all([
    prisma.erpSyncLog.findMany({
      where:   { orgId },
      orderBy: { startedAt: 'desc' },
      take:    limit,
      skip:    offset,
    }),
    prisma.erpSyncLog.count({ where: { orgId } }),
  ])

  return NextResponse.json({ data: logs, total, limit, offset })
}
