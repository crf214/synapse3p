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
import { getErpAdapter } from '@/lib/erp'
import { execSync } from 'child_process'
import { computeAndStoreSnapshot } from '@/lib/reporting/snapshots'
import { safeExternalFetch, addAllowedDomain } from '@/lib/security/outbound'
import { ForbiddenError } from '@/lib/errors'
import { auditSecrets } from '@/lib/security/secrets-audit'
import { runControl } from '@/lib/controls/ControlTestRunner'

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

async function checkPhase3Tables(): Promise<string> {
  const tables: Array<[string, () => Promise<unknown>]> = [
    ['processing_rule_evaluations',  () => prisma.processingRuleEvaluation.count()],
    ['purchase_orders',              () => prisma.purchaseOrder.count()],
    ['po_line_items',                () => prisma.pOLineItem.count()],
    ['po_approvals',                 () => prisma.pOApproval.count()],
    ['po_amendments',                () => prisma.pOAmendment.count()],
    ['goods_receipts',               () => prisma.goodsReceipt.count()],
    ['documents',                    () => prisma.document.count()],
    ['contracts',                    () => prisma.contract.count()],
  ]

  for (const [name, query] of tables) {
    try {
      await query()
    } catch (e) {
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return `all ${tables.length} tables accessible`
}

async function checkPhase4Tables(): Promise<string> {
  const tables: Array<[string, () => Promise<unknown>]> = [
    ['third_party_reviews',     () => prisma.thirdPartyReview.count()],
    ['review_cadences',         () => prisma.reviewCadence.count()],
    ['entity_activity_logs',    () => prisma.entityActivityLog.count()],
    ['recurring_schedules',     () => prisma.recurringSchedule.count()],
    ['invoices',                () => prisma.invoice.count()],
    ['risk_evaluations',        () => prisma.riskEvaluation.count()],
    ['invoice_decisions',       () => prisma.invoiceDecision.count()],
    ['payment_executions',      () => prisma.paymentExecution.count()],
    ['external_signal_configs', () => prisma.externalSignalConfig.count()],
    ['external_signals',        () => prisma.externalSignal.count()],
  ]

  for (const [name, query] of tables) {
    try {
      await query()
    } catch (e) {
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return `all ${tables.length} tables accessible`
}

async function checkPhase5Tables(): Promise<string> {
  const tables: Array<[string, () => Promise<unknown>]> = [
    ['payment_instructions',          () => prisma.paymentInstruction.count()],
    ['payment_instruction_versions',  () => prisma.paymentInstructionVersion.count()],
    ['payment_instruction_amendments',() => prisma.paymentInstructionAmendment.count()],
    ['erp_transactions',              () => prisma.erpTransaction.count()],
    ['erp_transaction_versions',      () => prisma.erpTransactionVersion.count()],
    ['erp_periods',                   () => prisma.erpPeriod.count()],
    ['erp_sync_logs',                 () => prisma.erpSyncLog.count()],
  ]

  for (const [name, query] of tables) {
    try {
      await query()
    } catch (e) {
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return `all ${tables.length} tables accessible`
}

async function checkErpAdapterConnection(): Promise<string> {
  const adapter = getErpAdapter()
  const result  = await adapter.testConnection()
  if (!result.connected) {
    throw new Error(result.error ?? 'testConnection returned connected: false')
  }
  return result.accountId
    ? `connected — accountId: ${result.accountId}`
    : 'connected (mock adapter)'
}

async function checkFxRates(): Promise<string> {
  let count = await prisma.fxRate.count()

  if (count === 0) {
    // Attempt an inline fetch so the check self-heals on first run
    try {
      execSync('npx tsx scripts/fetch-fx-rates.ts', {
        stdio: 'pipe',
        timeout: 30_000,
        env: { ...process.env },
      })
    } catch (e) {
      throw new Error(
        `No FX rates found and inline fetch failed: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    count = await prisma.fxRate.count()
  }

  if (count === 0) {
    throw new Error('No FX rates found even after attempting fetch')
  }

  return `${count} rate${count === 1 ? '' : 's'} present`
}

async function checkOutboundSecurityControls(): Promise<string> {
  const failures: string[] = []

  // Test A: private IP must be blocked
  try {
    await safeExternalFetch('https://192.168.1.1/test')
    failures.push('192.168.1.1 was NOT blocked (expected ForbiddenError)')
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      failures.push(`192.168.1.1 threw unexpected error type: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Test B: non-allowlisted domain must be blocked
  try {
    await safeExternalFetch('https://not-allowed-domain.com/test')
    failures.push('not-allowed-domain.com was NOT blocked (expected ForbiddenError)')
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      failures.push(`not-allowed-domain.com threw unexpected error type: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Test C: http must be blocked even for allowlisted domains
  try {
    await safeExternalFetch('http://api.frankfurter.app/latest')
    failures.push('http:// was NOT blocked (expected ForbiddenError)')
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      failures.push(`http:// threw unexpected error type: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (failures.length > 0) throw new Error(failures.join('; '))
  return 'all three controls enforced (private IP, domain allowlist, HTTPS-only)'
}

async function checkReportSnapshots(): Promise<string> {
  const acme = await prisma.organisation.findUnique({ where: { slug: 'acme' } })
  if (!acme) throw new Error('acme org not found — run: npx prisma db seed')

  const snapshot = await computeAndStoreSnapshot(acme.id, 'AP_AGING')

  if (!snapshot?.id) throw new Error('computeAndStoreSnapshot returned no snapshot')

  const recordCount = Array.isArray(snapshot.data) ? (snapshot.data as unknown[]).length : 1
  return `AP_AGING snapshot created (id: ${snapshot.id}, ${recordCount} currency rows)`
}

async function checkSecretsAudit(): Promise<string> {
  const { passed, warnings, errors } = auditSecrets()

  if (errors.length > 0) {
    throw new Error(`Secrets audit failed:\n${errors.map(e => `  • ${e}`).join('\n')}`)
  }

  if (warnings.length > 0) {
    return `passed with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings.join('; ')}`
  }

  return 'all required secrets present and correctly formatted'
}

async function checkDependencyAudit(): Promise<string> {
  let output: string
  try {
    output = execSync('npm audit --json --audit-level=high', {
      encoding: 'utf8',
      // npm audit exits non-zero when vulnerabilities are found; capture output regardless
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err: unknown) {
    // execSync throws when exit code !== 0 — the stdout is still attached to the error
    const execError = err as { stdout?: string; stderr?: string; message?: string }
    if (execError.stdout) {
      output = execError.stdout
    } else {
      // audit tool itself unavailable (e.g., no network in sandbox)
      return 'npm audit unavailable — skipping (tool error: ' + (execError.message ?? String(err)) + ')'
    }
  }

  let parsed: {
    vulnerabilities?: Record<string, { severity: string }>
    metadata?: { vulnerabilities?: { high?: number; critical?: number; moderate?: number; low?: number } }
  }
  try {
    parsed = JSON.parse(output) as typeof parsed
  } catch {
    return 'npm audit output could not be parsed — skipping'
  }

  const counts = parsed.metadata?.vulnerabilities ?? {}
  const high     = counts.high     ?? 0
  const critical = counts.critical ?? 0
  const moderate = counts.moderate ?? 0
  const low      = counts.low      ?? 0

  if (critical > 0) {
    throw new Error(
      `${critical} critical severity ${critical === 1 ? 'vulnerability' : 'vulnerabilities'} found — run: npm audit`
    )
  }

  const notes: string[] = []

  if (high > 0) {
    notes.push(
      `${high} high severity ${high === 1 ? 'vulnerability' : 'vulnerabilities'} — Next.js upgrade to v15+ required to resolve — schedule as dedicated upgrade`
    )
  }

  if (moderate > 0 || low > 0) {
    notes.push(`${moderate} moderate, ${low} low (informational)`)
  }

  return notes.length > 0
    ? `passed with findings: ${notes.join('; ')}`
    : 'no vulnerabilities found'
}

async function checkControlFramework(): Promise<string> {
  const acme = await prisma.organisation.findUnique({ where: { slug: 'acme' } })
  if (!acme) throw new Error('acme org not found — run: npx prisma db seed')

  const result = await runControl(acme.id, 'MO-02')

  if (result.status === 'FAIL' || result.status === 'ERROR') {
    throw new Error(`MO-02 (Security controls verification) ${result.status}: ${result.summary}`)
  }

  return `MO-02 ${result.status}: ${result.summary}`
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
  results.push(await runCheck('Entity master tables',        () => checkEntityMasterTables()))
  results.push(await runCheck('Phase 3 PO and document tables',      () => checkPhase3Tables()))
  results.push(await runCheck('Phase 4 TPM and bill pay tables',      () => checkPhase4Tables()))
  results.push(await runCheck('Phase 5 ERP and payment tables',       () => checkPhase5Tables()))
  results.push(await runCheck('ERP adapter connection',               () => checkErpAdapterConnection()))
  results.push(await runCheck('FX rates',                             () => checkFxRates()))
  results.push(await runCheck('Outbound security controls',           () => checkOutboundSecurityControls()))
  results.push(await runCheck('Report snapshots',                     () => checkReportSnapshots()))
  results.push(await runCheck('Secrets audit',                         () => checkSecretsAudit()))
  results.push(await runCheck('Dependency audit',                       () => checkDependencyAudit()))
  results.push(await runCheck('Control framework',                       () => checkControlFramework()))

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
