/**
 * Synapse3P Infrastructure Health Check
 *
 * Runs a suite of checks against the live infrastructure and sends a
 * SendGrid alert email if any fail. Safe to run in CI — all errors are
 * caught internally and the script exits 0 regardless.
 *
 * Usage:
 *   npx tsx scripts/health-check.ts
 *
 * Required env vars (loaded from .env.local in development):
 *   DATABASE_URL, DIRECT_URL
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 *   RESEND_API_KEY, ALERT_EMAIL, ALERT_FROM_EMAIL
 *
 * Optional:
 *   HEALTH_CHECK_BASE_URL  — if set, the API health check hits that base URL;
 *                            if unset the check is skipped (safe for CI)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import type { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// Load .env.local (dev only — CI injects secrets directly)
// ---------------------------------------------------------------------------
const envLocalPath = resolve(process.cwd(), '.env.local')
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CheckResult {
  name: string
  status: 'pass' | 'fail'
  message: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// Runner helper
// ---------------------------------------------------------------------------
async function runCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  const start = Date.now()
  try {
    const message = await fn()
    const durationMs = Date.now() - start
    console.log(`  PASS  ${name} (${durationMs}ms) — ${message}`)
    return { name, status: 'pass', message, durationMs }
  } catch (err: unknown) {
    const durationMs = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    console.log(`  FAIL  ${name} (${durationMs}ms) — ${message}`)
    return { name, status: 'fail', message, durationMs }
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkDatabase(prisma: PrismaClient): Promise<string> {
  await prisma.$queryRaw`SELECT 1`
  return 'SELECT 1 succeeded'
}

async function checkTenantIsolation(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.organisation.findMany({
    where: { id: '00000000-0000-0000-0000-000000000000' },
  })
  if (rows.length !== 0) throw new Error(`Expected 0 rows, got ${rows.length}`)
  return 'zero rows for non-existent org id'
}

async function checkSupabaseAuth(): Promise<string> {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  if (!url || !anonKey) throw new Error('Missing Supabase URL or anon key')

  const supabase = createClient(url, anonKey)
  await supabase.auth.signOut()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'admin.acme@test.com',
    password: 'password123',
  })
  if (error || !data.session) {
    throw new Error(error?.message ?? 'No session returned — user may not exist in Supabase Auth')
  }

  await supabase.auth.signOut()
  return `signed in as ${data.user?.email}`
}

async function checkJwtClaims(): Promise<string> {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  if (!url || !anonKey) throw new Error('Missing Supabase URL or anon key')

  const supabase = createClient(url, anonKey)
  await supabase.auth.signOut()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'admin.acme@test.com',
    password: 'password123',
  })
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Sign-in failed — cannot inspect JWT')
  }

  const token = data.session.access_token
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
  const appMeta = payload.app_metadata ?? {}

  const missing: string[] = []
  if (!appMeta.org_id) missing.push('org_id')
  if (!appMeta.role)   missing.push('role')

  await supabase.auth.signOut()

  if (missing.length > 0) {
    throw new Error(
      `JWT app_metadata missing: ${missing.join(', ')} — custom Auth hook not yet configured`
    )
  }
  return `JWT contains org_id=${appMeta.org_id} role=${appMeta.role}`
}

async function checkStorageBuckets(): Promise<string> {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!
  if (!url || !serviceKey) throw new Error('Missing Supabase URL or service key')

  const admin = createClient(url, serviceKey)
  const { data: buckets, error } = await admin.storage.listBuckets()
  if (error) throw new Error(error.message)

  const names = (buckets ?? []).map(b => b.name)
  const required = ['invoices', 'contracts', 'onboarding-docs']
  const missing  = required.filter(b => !names.includes(b))

  if (missing.length > 0) {
    throw new Error(`Missing buckets: ${missing.join(', ')}`)
  }
  return `buckets present: ${required.join(', ')}`
}

async function checkAuditLog(prisma: PrismaClient): Promise<string> {
  const testOrg = await prisma.organisation.create({
    data: {
      name: '__health_check_test__',
      slug: `__health_check_${Date.now()}__`,
    },
  })

  // Give the middleware a moment to flush the async write (it's in-process, so
  // the await inside the middleware should already be settled, but be explicit)
  const auditRows = await prisma.auditEvent.findMany({
    where: { entityType: 'Organisation', entityId: testOrg.id },
  })

  await prisma.organisation.delete({ where: { id: testOrg.id } })

  if (auditRows.length === 0) {
    throw new Error('No audit_events row found for the test Organisation create')
  }
  return `audit row created (id: ${auditRows[0].id})`
}

async function checkEntityMasterTables(): Promise<string> {
  const tables: Array<() => Promise<unknown>> = [
    () => prisma.entity.count(),
    () => prisma.entityClassification.count(),
    () => prisma.entityBankAccount.count(),
    () => prisma.entityDueDiligence.count(),
    () => prisma.entityFinancial.count(),
    () => prisma.entityRiskScore.count(),
    () => prisma.entityOrgRelationship.count(),
    () => prisma.serviceCatalogue.count(),
    () => prisma.serviceEngagement.count(),
  ]

  const names = [
    'entities',
    'entity_classifications',
    'entity_bank_accounts',
    'entity_due_diligence',
    'entity_financials',
    'entity_risk_scores',
    'entity_org_relationships',
    'service_catalogue',
    'service_engagements',
  ]

  for (let i = 0; i < tables.length; i++) {
    try {
      await tables[i]()
    } catch (e) {
      throw new Error(`${names[i]}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return `all ${tables.length} tables accessible`
}

async function checkApiHealth(): Promise<string> {
  const base = process.env.HEALTH_CHECK_BASE_URL
  if (!base) {
    // Returning a message here won't be used — the caller skips this check.
    return 'skipped'
  }
  const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json() as { status?: string }
  if (body.status !== 'ok') throw new Error(`Unexpected body: ${JSON.stringify(body)}`)
  return `status ok (${res.status})`
}

// ---------------------------------------------------------------------------
// SendGrid alert
// ---------------------------------------------------------------------------
async function sendAlert(failed: CheckResult[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const to     = process.env.ALERT_EMAIL

  if (!apiKey || !to) {
    console.log('\n  [alert] RESEND_API_KEY or ALERT_EMAIL not set — skipping email alert')
    return
  }

  const subject = `Synapse3p infrastructure alert — ${failed.length} check${failed.length === 1 ? '' : 's'} failed`
  const body = failed
    .map(c => `• ${c.name}: ${c.message}`)
    .join('\n')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Synapse3p Alerts <onboarding@resend.dev>',
      to,
      subject,
      text: `${subject}\n\n${body}`,
    }),
  })

  if (res.ok) {
    console.log(`\n  [alert] Email sent to ${to}`)
  } else {
    const text = await res.text()
    console.error(`\n  [alert] Resend error ${res.status}: ${text}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Synapse3P Health Check\n')

  const results: CheckResult[] = []

  results.push(await runCheck('Database connectivity',  () => checkDatabase(prisma)))
  results.push(await runCheck('Tenant isolation',       () => checkTenantIsolation(prisma)))
  results.push(await runCheck('Supabase Auth sign-in',  () => checkSupabaseAuth()))
  results.push(await runCheck('JWT claims',             () => checkJwtClaims()))
  results.push(await runCheck('Storage buckets',        () => checkStorageBuckets()))
  results.push(await runCheck('Audit log',              () => checkAuditLog(prisma)))
  results.push(await runCheck('Entity master tables',   () => checkEntityMasterTables()))

  // API health is optional — skip entirely if base URL not configured
  if (process.env.HEALTH_CHECK_BASE_URL) {
    results.push(await runCheck('API health endpoint', () => checkApiHealth()))
  } else {
    console.log('  SKIP  API health endpoint — HEALTH_CHECK_BASE_URL not set')
  }

  await prisma.$disconnect()

  const failed = results.filter(r => r.status === 'fail')
  const passed = results.filter(r => r.status === 'pass')

  console.log(`\n${passed.length} passed, ${failed.length} failed\n`)

  if (failed.length > 0) {
    await sendAlert(failed)
  }
}

main().catch(e => {
  console.error('Unexpected error in health check runner:', e)
  process.exit(0) // always exit 0 — alerting is handled inside main()
})
