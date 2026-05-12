import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const CRON_IDS = {
  recurringInvoices:  'cron:recurring-invoices',
  fxRates:            'cron:fx-rates',
  reviewCadenceCheck: 'cron:review-cadence-check',
  contractExpiry:     'cron:contract-expiry',
} as const

async function checkStorage(): Promise<'ok' | 'error'> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const bucket      = process.env.SUPABASE_STORAGE_BUCKET ?? 'synapse3p-files'
  if (!supabaseUrl) return 'error'
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/bucket/${bucket}`, {
      method:  'HEAD',
      signal:  AbortSignal.timeout(5_000),
    })
    return res.ok || res.status === 401 ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

async function getLastCronRun(objectId: string): Promise<{ lastRun: string | null; status: 'ok' | 'never_run' }> {
  try {
    const event = await prisma.auditEvent.findFirst({
      where:   { entityType: 'SYSTEM', entityId: objectId, action: 'CRON_RUN' },
      orderBy: { createdAt: 'desc' },
      select:  { createdAt: true },
    })
    if (!event) return { lastRun: null, status: 'never_run' }
    return { lastRun: event.createdAt.toISOString(), status: 'ok' }
  } catch {
    return { lastRun: null, status: 'never_run' }
  }
}

export async function GET() {
  // ── Database check ────────────────────────────────────────────────────────
  let database: 'ok' | 'error' = 'ok'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    database = 'error'
  }

  // ── Storage check (runs in parallel with cron queries) ────────────────────
  const [storage, recurringInvoices, fxRates, reviewCadenceCheck, contractExpiry] = await Promise.all([
    checkStorage(),
    getLastCronRun(CRON_IDS.recurringInvoices),
    getLastCronRun(CRON_IDS.fxRates),
    getLastCronRun(CRON_IDS.reviewCadenceCheck),
    getLastCronRun(CRON_IDS.contractExpiry),
  ])

  const cronSecret = Boolean(process.env.CRON_SECRET)

  const overallStatus: 'ok' | 'degraded' | 'down' =
    database === 'error' ? 'down' :
    storage  === 'error' ? 'degraded' :
    'ok'

  return NextResponse.json({
    status:     overallStatus,
    database,
    storage,
    cronSecret,
    crons: {
      recurringInvoices,
      fxRates,
      reviewCadenceCheck,
      contractExpiry,
    },
    timestamp: new Date().toISOString(),
  })
}
