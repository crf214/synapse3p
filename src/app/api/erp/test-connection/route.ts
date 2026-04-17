import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getErpAdapter } from '@/lib/erp'

// GET /api/erp/test-connection — verify ERP credentials and connectivity

export async function GET() {
  const session = await getSession()

  if (!session.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const adapter = getErpAdapter()
    const result  = await adapter.testConnection()
    return NextResponse.json({ ok: result.connected, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
