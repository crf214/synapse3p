// src/app/api/cron/recurring-invoices/route.ts
//
// Cron job — generates invoices for due recurring schedules.
// Called by Vercel Cron daily at 06:00 UTC (see vercel.json).
//
// REQUIRED ENV VAR: CRON_SECRET
//   Set this in Vercel → Project Settings → Environment Variables.
//   Use a long random string (min 32 chars). The cron request must include
//   `Authorization: Bearer <CRON_SECRET>` for the job to execute.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeAuditEvent } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Frequency → next run date
// ---------------------------------------------------------------------------

function computeNextRunAt(from: Date, frequency: string): Date {
  const next = new Date(from)
  switch (frequency.toUpperCase()) {
    case 'DAILY':     next.setDate(next.getDate() + 1);         break
    case 'WEEKLY':    next.setDate(next.getDate() + 7);         break
    case 'BIWEEKLY':  next.setDate(next.getDate() + 14);        break
    case 'MONTHLY':   next.setMonth(next.getMonth() + 1);       break
    case 'QUARTERLY': next.setMonth(next.getMonth() + 3);       break
    case 'ANNUAL':    next.setFullYear(next.getFullYear() + 1); break
    default:          next.setMonth(next.getMonth() + 1);       break  // safe fallback
  }
  return next
}

// ---------------------------------------------------------------------------
// GET /api/cron/recurring-invoices
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // ── Auth: Bearer token must match CRON_SECRET ────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/recurring-invoices] CRON_SECRET is not set — refusing to run')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Find all schedules due to run ────────────────────────────────────────
  const now = new Date()

  const dueSchedules = await prisma.recurringSchedule.findMany({
    where: {
      isActive: true,
      OR: [
        { nextRunAt: null },               // never run — eligible immediately
        { nextRunAt: { lte: now } },       // next run time has passed
      ],
    },
  })

  const errors: string[] = []
  let created = 0

  for (const sched of dueSchedules) {
    try {
      const invoiceDate = now
      const invoiceNo   = `REC-${sched.id.slice(-8).toUpperCase()}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const nextRunAt   = computeNextRunAt(now, sched.frequency)

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            orgId:               sched.orgId,
            invoiceNo,
            entityId:            sched.entityId,
            amount:              sched.expectedAmount,
            currency:            sched.currency,
            invoiceDate,
            status:              'PENDING_REVIEW',
            source:              'RECURRING',
            isRecurring:         true,
            recurringScheduleId: sched.id,
          },
        })

        await tx.recurringSchedule.update({
          where: { id: sched.id },
          data: {
            nextRunAt,
            lastInvoiceAt:     now,
            lastInvoiceAmount: sched.expectedAmount,
            invoiceCount:      { increment: 1 },
          },
        })

        await writeAuditEvent(tx, {
          actorId:    'cron',
          orgId:      sched.orgId,
          action:     'CREATE',
          objectType: 'INVOICE',
          objectId:   invoice.id,
          after:      { source: 'RECURRING', scheduleId: sched.id, invoiceNo },
        })
      })

      created++
    } catch (err) {
      const msg = `schedule ${sched.id}: ${err instanceof Error ? err.message : String(err)}`
      console.error('[cron/recurring-invoices] error processing', msg)
      errors.push(msg)
    }
  }

  console.log(`[cron/recurring-invoices] processed=${dueSchedules.length} created=${created} errors=${errors.length}`)

  return NextResponse.json({
    processed: dueSchedules.length,
    created,
    errors,
  })
}
