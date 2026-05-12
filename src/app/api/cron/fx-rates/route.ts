// src/app/api/cron/fx-rates/route.ts
//
// Cron job — fetches daily FX rates from Frankfurter (ECB data) and upserts
// into the FxRate table. Called by Vercel Cron daily at 07:00 UTC.
//
// REQUIRED ENV VAR: CRON_SECRET
//   Authorization: Bearer <CRON_SECRET>

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeAuditEvent } from '@/lib/audit'

const QUOTE_CURRENCIES = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD']
const FRANKFURTER_URL  = 'https://api.frankfurter.app/latest?from=USD'

interface FrankfurterResponse {
  base:  string
  date:  string
  rates: Record<string, number>
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/fx-rates] CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Fetch rates ───────────────────────────────────────────────────────────
  let apiData: FrankfurterResponse
  try {
    const res = await fetch(FRANKFURTER_URL, {
      headers: { 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`)
    apiData = await res.json() as FrankfurterResponse
  } catch (err) {
    console.error('[cron/fx-rates] failed to fetch from Frankfurter', err)
    return NextResponse.json({ error: 'Failed to fetch FX rates', details: String(err) }, { status: 502 })
  }

  const rateDate = new Date(`${apiData.date}T00:00:00Z`)
  let updated    = 0

  for (const currency of QUOTE_CURRENCIES) {
    const rate = apiData.rates[currency]
    if (rate === undefined) continue

    try {
      await prisma.fxRate.upsert({
        where: {
          baseCurrency_quoteCurrency_rateDate: {
            baseCurrency:  'USD',
            quoteCurrency: currency,
            rateDate,
          },
        },
        create: {
          baseCurrency:  'USD',
          quoteCurrency: currency,
          rate,
          rateDate,
          source:        'ECB',
        },
        update: { rate },
      })
      updated++
    } catch (err) {
      console.error(`[cron/fx-rates] failed to upsert ${currency}`, err)
    }
  }

  console.log(`[cron/fx-rates] updated=${updated} date=${apiData.date}`)

  void writeAuditEvent(prisma, {
    actorId:    'cron',
    orgId:      'system',
    action:     'CRON_RUN',
    objectType: 'SYSTEM',
    objectId:   'cron:fx-rates',
    after:      { cronName: 'fx-rates', updated, date: apiData.date },
  })

  return NextResponse.json({ updated, date: apiData.date })
}
