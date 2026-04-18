import { prisma } from '@/lib/prisma'

// ---------------------------------------------------------------------------
// getRate
// ---------------------------------------------------------------------------

/**
 * Returns how many USD equal 1 unit of quoteCurrency on or before `date`.
 * Falls back to the most recent rate if no exact match for that date.
 * Returns null if no rate exists for that currency at all.
 */
export async function getRate(
  quoteCurrency: string,
  date: Date,
): Promise<number | null> {
  if (quoteCurrency === 'USD') return 1.0

  const row = await prisma.fxRate.findFirst({
    where: {
      quoteCurrency,
      rateDate: { lte: date },
    },
    orderBy: { rateDate: 'desc' },
    select:  { rate: true },
  })

  return row?.rate ?? null
}

// ---------------------------------------------------------------------------
// convertToUsd
// ---------------------------------------------------------------------------

interface ConversionResult {
  usdAmount: number | null
  rate:      number | null
  rateDate:  Date   | null
}

/**
 * Converts an amount in any supported currency to USD.
 * Never throws — always returns an object (with nulls when rate is unavailable).
 */
export async function convertToUsd(
  amount:   number,
  currency: string,
  date:     Date,
): Promise<ConversionResult> {
  if (currency === 'USD') {
    return { usdAmount: amount, rate: 1, rateDate: date }
  }

  try {
    const row = await prisma.fxRate.findFirst({
      where: {
        quoteCurrency: currency,
        rateDate: { lte: date },
      },
      orderBy: { rateDate: 'desc' },
      select:  { rate: true, rateDate: true },
    })

    if (!row) return { usdAmount: null, rate: null, rateDate: null }

    return {
      usdAmount: amount * row.rate,
      rate:      row.rate,
      rateDate:  row.rateDate,
    }
  } catch {
    return { usdAmount: null, rate: null, rateDate: null }
  }
}

// ---------------------------------------------------------------------------
// formatMultiCurrency
// ---------------------------------------------------------------------------

/**
 * Groups and sums amounts by currency. NEVER sums across currencies —
 * use convertToUsd() first if a single total is required.
 */
export function formatMultiCurrency(
  amounts: Array<{ amount: number; currency: string }>,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const { amount, currency } of amounts) {
    result[currency] = (result[currency] ?? 0) + amount
  }
  return result
}
