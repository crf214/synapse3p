/**
 * Synapse3P — External Signals Nightly Batch
 *
 * Monitors news and stock price signals for all active entity configs and
 * stores results as ExternalSignal records. Sends Resend alert emails to
 * configured recipients. Never throws — errors are caught per-entity.
 *
 * Usage:
 *   npx tsx scripts/external-signals.ts
 *
 * Required env vars:
 *   DATABASE_URL, NEWS_API_KEY, RESEND_API_KEY
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { prisma } from '@/lib/prisma'
import type { SignalSeverity, SignalType } from '@prisma/client'
import { safeExternalFetch } from '@/lib/security/outbound'
import { sanitiseNewsArticle, sanitiseStockData } from '@/lib/security/sanitise'
import { fetchAndStorePrices, backfillHistory, getLatestPrice } from '@/lib/stocks/StockPriceService'

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

const CRITICAL_WORDS = ['bankruptcy', 'fraud', 'criminal', 'arrest', 'sanction', 'collapse', 'breach', 'hack']
const HIGH_WORDS     = ['lawsuit', 'investigation', 'regulatory', 'fine', 'penalty', 'warning', 'downgrade']
const MEDIUM_WORDS   = ['concern', 'risk', 'decline', 'loss', 'cut', 'delay']

function detectNewsSeverity(title: string, description: string): SignalSeverity {
  const text = `${title} ${description}`.toLowerCase()
  if (CRITICAL_WORDS.some(w => text.includes(w))) return 'CRITICAL'
  if (HIGH_WORDS.some(w => text.includes(w)))     return 'HIGH'
  if (MEDIUM_WORDS.some(w => text.includes(w)))   return 'MEDIUM'
  return 'LOW'
}

function stockSeverity(dropPct: number): SignalSeverity {
  if (dropPct > 15) return 'CRITICAL'
  if (dropPct > 8)  return 'HIGH'
  if (dropPct > 3)  return 'MEDIUM'
  return 'LOW'
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function yesterday(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Resend alert
// ---------------------------------------------------------------------------
async function sendResendAlert(
  toEmail: string,
  subject: string,
  body: string,
): Promise<void> {
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
// News monitoring
// ---------------------------------------------------------------------------
interface NewsArticle {
  title: string
  description: string | null
  url: string
  source: { name: string }
  publishedAt: string
}

async function processNews(
  config: {
    entityId: string
    orgId: string
    companyName: string
    newsKeywords: string[]
    severityThreshold: SignalSeverity
  },
  entityName: string,
): Promise<number> {
  const apiKey = process.env.NEWS_API_KEY
  if (!apiKey) {
    console.log('    [news] NEWS_API_KEY not set — skipping')
    return 0
  }

  const terms = [config.companyName, ...config.newsKeywords].join(' OR ')
  const url = new URL('https://newsapi.org/v2/everything')
  url.searchParams.set('q', terms)
  url.searchParams.set('sortBy', 'publishedAt')
  url.searchParams.set('pageSize', '5')
  url.searchParams.set('from', yesterday())
  url.searchParams.set('apiKey', apiKey)

  const res = await safeExternalFetch(url.toString(), {}, 'external-signals:news')
  if (!res.ok) throw new Error(`NewsAPI ${res.status}: ${await res.text()}`)

  const data = await res.json() as { articles?: unknown[] }
  const articles = data.articles ?? []
  let stored = 0

  for (const rawArticle of articles) {
    // Sanitise all third-party data before touching the database
    const article = sanitiseNewsArticle(rawArticle)
    if (!article) continue

    const severity = detectNewsSeverity(article.title, article.description)
    if (!meetsThreshold(severity, config.severityThreshold)) continue

    // Deduplication: skip if same sourceUrl already exists for this entity
    if (article.url) {
      const existing = await prisma.externalSignal.findFirst({
        where: { entityId: config.entityId, sourceUrl: article.url },
        select: { id: true },
      })
      if (existing) continue
    }

    await prisma.externalSignal.create({
      data: {
        entityId:   config.entityId,
        orgId:      config.orgId,
        signalType: 'NEWS',
        severity,
        title:      article.title,
        summary:    article.description || article.title,
        sourceUrl:  article.url,
        sourceName: article.sourceName,
        rawData:    rawArticle as object,
        publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
      },
    })

    await prisma.entityActivityLog.create({
      data: {
        entityId:      config.entityId,
        orgId:         config.orgId,
        activityType:  'EXTERNAL_SIGNAL',
        title:         `News signal (${severity}): ${article.title}`,
        description:   article.description || undefined,
        referenceType: 'ExternalSignal',
        performedBy:   'system',
        metadata:      { signalType: 'NEWS', severity, sourceUrl: article.url },
      },
    })

    stored++
    console.log(`    [news] ${severity}: ${article.title.slice(0, 80)}`)

    // Alert recipients
    await sendSignalAlerts(config, entityName, 'NEWS', severity, article.title, article.description, article.url ?? undefined, article.sourceName)
  }

  return stored
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
  config: {
    entityId: string
    orgId: string
    stockTicker: string
    severityThreshold: SignalSeverity
  },
  entityName: string,
): Promise<number> {
  // Store price history — backfill 18 months on first run, otherwise just today
  const existing = await getLatestPrice(config.entityId, config.stockTicker)
  if (!existing) {
    const stored = await backfillHistory(config.entityId, config.stockTicker)
    console.log(`    [stock] Backfilled ${stored} days of history for ${config.stockTicker}`)
  } else {
    await fetchAndStorePrices(config.entityId, config.stockTicker, 5)
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.stockTicker)}?interval=1d&range=5d`
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

  if (!meetsThreshold(severity, config.severityThreshold)) return 0

  const title   = `${config.stockTicker} dropped ${dropPct.toFixed(2)}%`
  const summary = `${config.stockTicker} closed at ${latest.toFixed(2)}, down ${dropPct.toFixed(2)}% from previous close of ${prev.toFixed(2)}.`

  await prisma.externalSignal.create({
    data: {
      entityId:   config.entityId,
      orgId:      config.orgId,
      signalType: 'STOCK_PRICE',
      severity,
      title,
      summary,
      sourceName: 'Yahoo Finance',
      rawData:    { ticker: config.stockTicker, prev, latest, changePct },
      affectedRiskScore: severity === 'HIGH' || severity === 'CRITICAL',
    },
  })

  await prisma.entityActivityLog.create({
    data: {
      entityId:      config.entityId,
      orgId:         config.orgId,
      activityType:  'EXTERNAL_SIGNAL',
      title:         `Stock signal (${severity}): ${title}`,
      description:   summary,
      referenceType: 'ExternalSignal',
      performedBy:   'system',
      metadata:      { signalType: 'STOCK_PRICE', severity, ticker: config.stockTicker, changePct },
    },
  })

  console.log(`    [stock] ${severity}: ${title}`)
  await sendSignalAlerts(config, entityName, 'STOCK_PRICE', severity, title, summary, undefined, 'Yahoo Finance')

  return 1
}

// ---------------------------------------------------------------------------
// Send alerts to configured recipients
// ---------------------------------------------------------------------------
async function sendSignalAlerts(
  config: { entityId: string; alertRecipients?: string[] },
  entityName: string,
  signalType: SignalType,
  severity: SignalSeverity,
  title: string,
  summary: string,
  sourceUrl?: string,
  sourceName?: string,
): Promise<void> {
  const recipients = (config as { alertRecipients?: string[] }).alertRecipients ?? []
  if (recipients.length === 0) return

  const users = await prisma.user.findMany({
    where: { id: { in: recipients } },
    select: { id: true, email: true },
  })

  const subject = `External signal detected: ${entityName} — ${severity}`
  const body = [
    `Entity: ${entityName}`,
    `Signal type: ${signalType}`,
    `Severity: ${severity}`,
    ``,
    title,
    summary,
    sourceName ? `Source: ${sourceName}` : '',
    sourceUrl  ? `URL: ${sourceUrl}` : '',
    ``,
    `Detected at: ${new Date().toISOString()}`,
  ].filter(l => l !== undefined).join('\n')

  for (const user of users) {
    await sendResendAlert(user.email, subject, body)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Synapse3P External Signals Batch\n')

  const configs = await prisma.externalSignalConfig.findMany({
    where: { isActive: true },
    include: { entity: { select: { name: true } } },
  })

  console.log(`Loaded ${configs.length} active signal config(s)\n`)

  let entitiesChecked = 0
  let signalsDetected = 0

  for (const config of configs) {
    const entityName = config.entity.name
    console.log(`Checking: ${entityName} (${config.entityId})`)
    entitiesChecked++

    try {
      if ((config.signalTypes as SignalType[]).includes('NEWS')) {
        const count = await processNews(
          {
            entityId:          config.entityId,
            orgId:             config.orgId,
            companyName:       config.companyName,
            newsKeywords:      config.newsKeywords as string[],
            severityThreshold: config.severityThreshold as SignalSeverity,
          },
          entityName,
        )
        signalsDetected += count
      }

      if ((config.signalTypes as SignalType[]).includes('STOCK_PRICE') && config.stockTicker) {
        const count = await processStock(
          {
            entityId:          config.entityId,
            orgId:             config.orgId,
            stockTicker:       config.stockTicker,
            severityThreshold: config.severityThreshold as SignalSeverity,
          },
          entityName,
        )
        signalsDetected += count
      }
    } catch (err) {
      console.error(`  ERROR processing ${entityName}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\nDone. ${entitiesChecked} entities checked, ${signalsDetected} signals detected.`)
}

main()
  .catch(e => console.error('Unexpected error:', e))
  .finally(() => prisma.$disconnect())
