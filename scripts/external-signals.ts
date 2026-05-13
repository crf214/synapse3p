/**
 * Synapse3P — External Signals Nightly Batch
 *
 * Monitors stock price signals for every entity that has a stockTicker set.
 * No separate config table is required — simply set Entity.stockTicker and
 * signals will be picked up automatically on the next run.
 *
 * Usage:
 *   npx tsx scripts/external-signals.ts
 *
 * Required env vars:
 *   DATABASE_URL, RESEND_API_KEY (optional — only needed for email alerts)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { prisma } from '@/lib/prisma'
import type { SignalSeverity } from '@prisma/client'
import { safeExternalFetch } from '@/lib/security/outbound'
import { sanitiseStockData } from '@/lib/security/sanitise'
import { fetchAndStorePrices, backfillHistory, getLatestPrice } from '@/lib/stocks/StockPriceService'
import { writeAuditEvent } from '@/lib/audit'

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
// Severity helpers
// ---------------------------------------------------------------------------
const SEVERITY_ORDER: Record<SignalSeverity, number> = {
  LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3,
}

function meetsThreshold(severity: SignalSeverity, threshold: SignalSeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold]
}

function stockSeverity(dropPct: number): SignalSeverity {
  if (dropPct > 15) return 'CRITICAL'
  if (dropPct > 8)  return 'HIGH'
  if (dropPct > 3)  return 'MEDIUM'
  return 'LOW'
}

// ---------------------------------------------------------------------------
// Resend alert
// ---------------------------------------------------------------------------
async function sendResendAlert(toEmail: string, subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const res = await safeExternalFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Synapse3p Alerts <onboarding@resend.dev>',
      to: toEmail,
      subject,
      text: body,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`    [resend] Failed to ${toEmail}: ${res.status} ${text}`)
  }
}

// ---------------------------------------------------------------------------
// Stock price monitoring
// ---------------------------------------------------------------------------
interface YahooChartResponse {
  chart: {
    result?: Array<{
      indicators: { quote: Array<{ close: (number | null)[] }> }
    }>
    error?: { description: string }
  }
}

async function processStock(
  entityId: string,
  orgId: string,
  ticker: string,
  entityName: string,
  severityThreshold: SignalSeverity = 'LOW',
  alertRecipientIds: string[] = [],
): Promise<number> {
  // Store price history — backfill 18 months on first run, otherwise just recent days
  const existing = await getLatestPrice(entityId, ticker)
  if (!existing) {
    const stored = await backfillHistory(entityId, ticker)
    console.log(`    [stock] Backfilled ${stored} days of history for ${ticker}`)
  } else {
    await fetchAndStorePrices(entityId, ticker, 5)
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`
  const res = await safeExternalFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 'external-signals:stock')
  if (!res.ok) throw new Error(`Yahoo Finance ${res.status}`)

  const data = await res.json() as YahooChartResponse
  if (data.chart.error) throw new Error(data.chart.error.description)

  // Sanitise all third-party data before touching the database
  const stock = sanitiseStockData(data)
  if (!stock || stock.previousClose === null || stock.lastClose === null) {
    console.log('    [stock] Not enough valid data points')
    return 0
  }

  const prev      = stock.previousClose
  const latest    = stock.lastClose
  const changePct = ((latest - prev) / prev) * 100

  // Only alert on drops
  if (changePct >= 0) return 0

  const dropPct  = Math.abs(changePct)
  const severity = stockSeverity(dropPct)

  if (!meetsThreshold(severity, severityThreshold)) return 0

  const title   = `${ticker} dropped ${dropPct.toFixed(2)}%`
  const summary = `${ticker} closed at ${latest.toFixed(2)}, down ${dropPct.toFixed(2)}% from previous close of ${prev.toFixed(2)}.`

  await prisma.externalSignal.create({
    data: {
      entityId,
      orgId,
      signalType: 'STOCK_PRICE',
      severity,
      title,
      summary,
      sourceName: 'Yahoo Finance',
      rawData:    { ticker, prev, latest, changePct },
      affectedRiskScore: severity === 'HIGH' || severity === 'CRITICAL',
    },
  })

  await prisma.entityActivityLog.create({
    data: {
      entityId,
      orgId,
      activityType:  'EXTERNAL_SIGNAL',
      title:         `Stock signal (${severity}): ${title}`,
      description:   summary,
      referenceType: 'ExternalSignal',
      performedBy:   'system',
      metadata:      { signalType: 'STOCK_PRICE', severity, ticker, changePct },
    },
  })

  console.log(`    [stock] ${severity}: ${title}`)

  // Audit log — record signal creation for compliance trail
  await writeAuditEvent(prisma, {
    actorId:    'system',
    orgId,
    action:     'CREATE',
    objectType: 'EXTERNAL_SIGNAL',
    objectId:   entityId,
    after: {
      signalType:  'STOCK_PRICE',
      severity,
      ticker,
      source:      'Yahoo Finance',
      signalCount: 1,
    },
  })

  // Send email alerts to configured recipients (if any)
  if (alertRecipientIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: alertRecipientIds } },
      select: { email: true },
    })
    const subject = `Stock signal: ${entityName} — ${severity}`
    const body = [
      `Entity: ${entityName}`,
      `Ticker: ${ticker}`,
      `Severity: ${severity}`,
      ``,
      title,
      summary,
      `Source: Yahoo Finance`,
      ``,
      `Detected at: ${new Date().toISOString()}`,
    ].join('\n')
    for (const user of users) {
      await sendResendAlert(user.email, subject, body)
    }
  }

  return 1
}

// ---------------------------------------------------------------------------
// Main — driven entirely by Entity.stockTicker
// ---------------------------------------------------------------------------
async function main() {
  console.log('Synapse3P External Signals Batch — Stock Price Monitoring\n')

  // Require secret to be set — prevents accidental runs without auth
  if (!process.env.EXTERNAL_SIGNALS_SECRET) {
    console.error('ERROR: EXTERNAL_SIGNALS_SECRET env var is not set. Aborting.')
    process.exit(1)
  }

  // Find all entities that have a stock ticker set; no separate config required
  const entities = await prisma.entity.findMany({
    where:  { stockTicker: { not: null } },
    select: { id: true, name: true, masterOrgId: true, stockTicker: true },
  })

  if (entities.length === 0) {
    console.log('No entities have a stock ticker set. Add a ticker to an entity to enable monitoring.')
    return
  }

  console.log(`Found ${entities.length} entity/entities with stock ticker(s)\n`)

  let signalsDetected = 0

  for (const entity of entities) {
    const ticker = entity.stockTicker!
    console.log(`Checking: ${entity.name} [${ticker}]`)
    try {
      const count = await processStock(
        entity.id,
        entity.masterOrgId,
        ticker,
        entity.name,
        'LOW',  // capture all drops (no config-level threshold)
        [],     // no alert recipients without a config; set up via ExternalSignalConfig if needed
      )
      signalsDetected += count
    } catch (err) {
      console.error(`  ERROR processing ${entity.name}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\nDone. ${entities.length} entity/entities checked, ${signalsDetected} signal(s) detected.`)
}

main()
  .catch(e => console.error('Unexpected error:', e))
  .finally(() => prisma.$disconnect())
