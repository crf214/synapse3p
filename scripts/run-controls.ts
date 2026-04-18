/**
 * Synapse3P — Control Test Batch Runner
 *
 * Runs all automated control tests for every active org and sends Resend alert
 * emails if any controls fail. Never throws — errors are caught per-org.
 *
 * Usage:
 *   npx tsx scripts/run-controls.ts
 *
 * Required env vars:
 *   DATABASE_URL
 * Optional:
 *   RESEND_API_KEY, ALERT_EMAIL — required for failure alerts
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { prisma } from '@/lib/prisma'
import { runAllControls } from '@/lib/controls/ControlTestRunner'

// ---------------------------------------------------------------------------
// Load .env.local in development
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
// Resend alert for failed controls
// ---------------------------------------------------------------------------
interface FailedControl {
  controlId: string
  summary:   string
}

async function sendFailureAlert(orgName: string, failures: FailedControl[]): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const to     = process.env.ALERT_EMAIL
  if (!apiKey || !to) return

  const subject = `Control failures detected — ${orgName} — ${failures.length} control${failures.length === 1 ? '' : 's'} failed`
  const body = [
    `Control failures detected in ${orgName}:`,
    '',
    ...failures.map(f => `  • ${f.controlId}: ${f.summary}`),
    '',
    `Detected at: ${new Date().toISOString()}`,
  ].join('\n')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        from:    'Synapse3p Controls <onboarding@resend.dev>',
        to,
        subject,
        text:    body,
      }),
    })
    if (!res.ok) {
      console.error(`  [alert] Resend error ${res.status}: ${await res.text()}`)
    }
  } catch (err) {
    console.error('  [alert] Failed to send alert:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Synapse3P Control Test Batch\n')

  const orgs = await prisma.organisation.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  })

  console.log(`Found ${orgs.length} org(s)\n`)

  let totalPassed   = 0
  let totalFailed   = 0
  let totalWarnings = 0
  let totalErrors   = 0
  let totalNotRun   = 0

  for (const org of orgs) {
    console.log(`Running controls for: ${org.name} (${org.id})`)
    try {
      const counts = await runAllControls(org.id)

      totalPassed   += counts.passed
      totalFailed   += counts.failed
      totalWarnings += counts.warnings
      totalErrors   += counts.errors
      totalNotRun   += counts.notRun

      console.log(
        `  Org: ${org.name} — ${counts.passed} passed, ${counts.failed} failed, ` +
        `${counts.warnings} warnings, ${counts.errors} errors, ${counts.notRun} not run`
      )

      // Alert on failures
      if (counts.failed > 0) {
        // Fetch the actual failed results to include in the alert
        const failedResults = await prisma.controlTestResult.findMany({
          where: {
            orgId:  org.id,
            status: 'FAIL',
            // Most recent batch — created in the last 10 minutes
            testedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          },
          include: { control: { select: { controlId: true } } },
          orderBy: { testedAt: 'desc' },
        })

        const failures: FailedControl[] = failedResults.map(r => ({
          controlId: r.control.controlId,
          summary:   r.summary,
        }))

        await sendFailureAlert(org.name, failures)
      }
    } catch (err) {
      console.error(`  ERROR processing ${org.name}:`, err instanceof Error ? err.message : err)
      totalErrors++
    }
  }

  console.log('\n─────────────────────────────────────────')
  console.log(
    `Total: ${totalPassed} passed, ${totalFailed} failed, ` +
    `${totalWarnings} warnings, ${totalErrors} errors, ${totalNotRun} not run`
  )
  console.log(`Across ${orgs.length} org(s)`)
}

main()
  .catch(e => console.error('Unexpected error:', e))
  .finally(() => prisma.$disconnect())
