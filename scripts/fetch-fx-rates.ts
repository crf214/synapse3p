/**
 * Nightly FX rate fetch — pulls latest rates from Frankfurter (ECB data, no API key needed).
 * Upserts one FxRate row per currency for today, and backfills yesterday if missing.
 *
 * Usage:
 *   npx tsx scripts/fetch-fx-rates.ts
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'
import { safeExternalFetch } from '@/lib/security/outbound'

// Load .env.local in development
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

const prisma = new PrismaClient()

interface FrankfurterResponse {
  base:  string
  date:  string
  rates: Record<string, number>
}

function midnightUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

async function fetchAndUpsert(isoDate: string): Promise<number> {
  const url = `https://api.frankfurter.app/${isoDate}?from=USD`
  const res  = await safeExternalFetch(url, {}, 'fetch-fx-rates')

  if (!res.ok) throw new Error(`Frankfurter returned HTTP ${res.status} for ${isoDate}`)

  const data = await res.json() as FrankfurterResponse

  // Frankfurter may redirect to the closest available trading day
  const actualDate = midnightUtc(new Date(data.date))

  const upserts = Object.entries(data.rates).map(([quoteCurrency, rate]) =>
    prisma.fxRate.upsert({
      where: {
        baseCurrency_quoteCurrency_rateDate: {
          baseCurrency:  'USD',
          quoteCurrency,
          rateDate:      actualDate,
        },
      },
      update: { rate, source: 'ECB' },
      create: {
        baseCurrency:  'USD',
        quoteCurrency,
        rate,
        rateDate:      actualDate,
        source:        'ECB',
      },
    })
  )

  await Promise.all(upserts)
  console.log(`Fetched ${upserts.length} rates for ${data.date} (actual: ${actualDate.toISOString().slice(0, 10)})`)
  return upserts.length
}

async function dateHasRates(isoDate: string): Promise<boolean> {
  const d = midnightUtc(new Date(isoDate))
  const count = await prisma.fxRate.count({ where: { rateDate: d } })
  return count > 0
}

async function main() {
  const today     = new Date()
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)

  const todayIso     = today.toISOString().slice(0, 10)
  const yesterdayIso = yesterday.toISOString().slice(0, 10)

  // Always fetch today
  try {
    await fetchAndUpsert(todayIso)
  } catch (err) {
    console.error(`Error fetching rates for ${todayIso}:`, err instanceof Error ? err.message : err)
  }

  // Backfill yesterday if missing (handles weekends — Frankfurter redirects to Friday)
  try {
    const hasYesterday = await dateHasRates(yesterdayIso)
    if (!hasYesterday) {
      await fetchAndUpsert(yesterdayIso)
    } else {
      console.log(`Rates for ${yesterdayIso} already present — skipping backfill`)
    }
  } catch (err) {
    console.error(`Error backfilling rates for ${yesterdayIso}:`, err instanceof Error ? err.message : err)
  }
}

main()
  .catch(e => console.error('Unexpected error in fetch-fx-rates:', e))
  .finally(() => prisma.$disconnect())
