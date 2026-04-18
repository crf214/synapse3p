/**
 * StockPriceService — fetches and stores daily OHLCV price history
 * from Yahoo Finance for a given entity/ticker pair.
 *
 * All outbound requests go through safeExternalFetch (SSRF protection,
 * HTTPS-only, domain allowlist). Data is sanitised before storage.
 */

import { prisma } from '@/lib/prisma'
import type { EntityStockPrice } from '@prisma/client'
import { safeExternalFetch } from '@/lib/security/outbound'
import { sanitiseNumber } from '@/lib/security/sanitise'

// ---------------------------------------------------------------------------
// Yahoo Finance response shape (v8 chart API)
// ---------------------------------------------------------------------------
interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: {
        currency:        string
        symbol:          string
        fiftyTwoWeekHigh?: number
        fiftyTwoWeekLow?:  number
      }
      timestamp: number[]
      indicators: {
        quote: Array<{
          open:   (number | null)[]
          high:   (number | null)[]
          low:    (number | null)[]
          close:  (number | null)[]
          volume: (number | null)[]
        }>
      }
    }>
    error?: { description: string }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rangeForDays(days: number): string {
  if (days <= 10)  return '5d'
  if (days <= 100) return '3mo'
  if (days <= 400) return '1y'
  return '2y'
}

/** Midnight UTC for a Unix timestamp (seconds) */
function toMidnightUtc(unixSec: number): Date {
  const d = new Date(unixSec * 1000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// ---------------------------------------------------------------------------
// fetchAndStorePrices
// ---------------------------------------------------------------------------
export async function fetchAndStorePrices(
  entityId: string,
  ticker:   string,
  days     = 5,
): Promise<number> {
  try {
    const range = rangeForDays(days)
    const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`

    const res = await safeExternalFetch(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      'stock-price-service',
    )
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`)

    const data = await res.json() as YahooChartResponse
    if (data.chart.error) throw new Error(data.chart.error.description)

    const result = data.chart.result?.[0]
    if (!result) throw new Error('No chart result returned')

    const { timestamp, indicators, meta } = result
    const quote    = indicators.quote[0]
    const currency = meta.currency ?? 'USD'

    if (!timestamp?.length || !quote) throw new Error('Empty chart data')

    // Compute 52-week high/low from the fetched closes (up to 252 trading days)
    const allCloses = quote.close
      .map((c, i) => ({ close: sanitiseNumber(c, -1e9, 1e9), i }))
      .filter((x): x is { close: number; i: number } => x.close !== null)

    const recentCloses = allCloses.slice(-252).map(x => x.close)
    const computed52High = recentCloses.length >= 2 ? Math.max(...recentCloses) : null
    const computed52Low  = recentCloses.length >= 2 ? Math.min(...recentCloses) : null

    // Prefer meta values if present, fall back to computed
    const week52High = sanitiseNumber(meta.fiftyTwoWeekHigh, -1e9, 1e9) ?? computed52High
    const week52Low  = sanitiseNumber(meta.fiftyTwoWeekLow,  -1e9, 1e9) ?? computed52Low

    // Build rows, computing day-over-day change
    const rows: Array<{
      priceDate:  Date
      closePrice: number
      openPrice:  number | null
      highPrice:  number | null
      lowPrice:   number | null
      volume:     bigint | null
      changeAmt:  number | null
      changePct:  number | null
      week52High: number | null
      week52Low:  number | null
      currency:   string
    }> = []

    for (let i = 0; i < timestamp.length; i++) {
      const close = sanitiseNumber(quote.close[i],  -1e9, 1e9)
      if (close === null) continue   // skip days with no close (market closed)

      const open   = sanitiseNumber(quote.open[i],   -1e9, 1e9)
      const high   = sanitiseNumber(quote.high[i],   -1e9, 1e9)
      const low    = sanitiseNumber(quote.low[i],    -1e9, 1e9)
      const vol    = quote.volume[i] != null && isFinite(quote.volume[i]!) && quote.volume[i]! >= 0
        ? BigInt(Math.round(quote.volume[i]!))
        : null

      // Day-over-day change — look back to find the previous valid close
      let changeAmt: number | null = null
      let changePct: number | null = null
      if (rows.length > 0) {
        const prev = rows[rows.length - 1].closePrice
        changeAmt  = parseFloat((close - prev).toFixed(6))
        changePct  = parseFloat(((close - prev) / prev * 100).toFixed(4))
      }

      rows.push({
        priceDate:  toMidnightUtc(timestamp[i]),
        closePrice: close,
        openPrice:  open,
        highPrice:  high,
        lowPrice:   low,
        volume:     vol,
        changeAmt,
        changePct,
        week52High,
        week52Low,
        currency,
      })
    }

    // Upsert all rows
    let upserted = 0
    for (const row of rows) {
      await prisma.entityStockPrice.upsert({
        where:  { entityId_ticker_priceDate: { entityId, ticker, priceDate: row.priceDate } },
        update: {
          closePrice: row.closePrice,
          openPrice:  row.openPrice,
          highPrice:  row.highPrice,
          lowPrice:   row.lowPrice,
          volume:     row.volume,
          changeAmt:  row.changeAmt,
          changePct:  row.changePct,
          week52High: row.week52High,
          week52Low:  row.week52Low,
        },
        create: {
          entityId,
          ticker,
          priceDate:  row.priceDate,
          closePrice: row.closePrice,
          openPrice:  row.openPrice,
          highPrice:  row.highPrice,
          lowPrice:   row.lowPrice,
          volume:     row.volume,
          changeAmt:  row.changeAmt,
          changePct:  row.changePct,
          week52High: row.week52High,
          week52Low:  row.week52Low,
          currency:   row.currency,
          source:     'yahoo_finance',
        },
      })
      upserted++
    }

    return upserted
  } catch (err) {
    console.error(
      `[StockPriceService] fetchAndStorePrices failed for ${ticker}:`,
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}

// ---------------------------------------------------------------------------
// backfillHistory — 18 months of history
// ---------------------------------------------------------------------------
export async function backfillHistory(entityId: string, ticker: string): Promise<number> {
  return fetchAndStorePrices(entityId, ticker, 540)
}

// ---------------------------------------------------------------------------
// getLatestPrice
// ---------------------------------------------------------------------------
export async function getLatestPrice(
  entityId: string,
  ticker:   string,
): Promise<EntityStockPrice | null> {
  return prisma.entityStockPrice.findFirst({
    where:   { entityId, ticker },
    orderBy: { priceDate: 'desc' },
  })
}

// ---------------------------------------------------------------------------
// getPriceHistory
// ---------------------------------------------------------------------------
export async function getPriceHistory(
  entityId: string,
  ticker:   string,
  days     = 365,
): Promise<EntityStockPrice[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return prisma.entityStockPrice.findMany({
    where:   { entityId, ticker, priceDate: { gte: since } },
    orderBy: { priceDate: 'asc' },
  })
}
