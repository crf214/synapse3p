// src/app/api/cron/review-cadence-check/route.ts
//
// Cron job — checks all active entities against their review cadences.
// For each org with overdue entities:
//   1. Creates an EntityActivityLog entry per overdue entity
//   2. Sends one summary email to FINANCE_MANAGER and CONTROLLER users in that org
//
// Called by Vercel Cron every Monday at 08:00 UTC (see vercel.json).
//
// REQUIRED ENV VAR: CRON_SECRET

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeAuditEvent } from '@/lib/audit'
import { getEntitiesDueForReview } from '@/lib/risk/check-review-cadence'
import { Resend } from 'resend'

const FROM    = process.env.RESEND_FROM_EMAIL ?? 'notifications@synapse3p.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function buildOverdueEmail(overdueEntities: { entityId: string; entityName: string; riskBand: string | null; daysOverdue: number }[]) {
  const rows = overdueEntities.map(e => `
    <tr>
      <td style="padding: 8px 0; font-size: 13px; color: #111; border-bottom: 1px solid #f1f5f9;">${e.entityName}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #555; border-bottom: 1px solid #f1f5f9; text-align: center;">${e.riskBand ?? '—'}</td>
      <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: #dc2626; border-bottom: 1px solid #f1f5f9; text-align: right;">${e.daysOverdue}d overdue</td>
    </tr>
  `).join('')

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #fff;">
      <div style="font-size: 20px; font-weight: 600; color: #111; margin-bottom: 8px;">Periodic Review Alert</div>
      <p style="color: #555; margin: 0 0 24px;">
        The following ${overdueEntities.length} vendor${overdueEntities.length !== 1 ? 's are' : ' is'} overdue for a periodic review.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <thead>
          <tr>
            <th style="padding: 8px 0; font-size: 12px; color: #888; text-align: left; border-bottom: 2px solid #e2e8f0;">Entity</th>
            <th style="padding: 8px 0; font-size: 12px; color: #888; text-align: center; border-bottom: 2px solid #e2e8f0;">Risk Band</th>
            <th style="padding: 8px 0; font-size: 12px; color: #888; text-align: right; border-bottom: 2px solid #e2e8f0;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <a href="${APP_URL}/dashboard/reviews" style="display: inline-block; background: #2563eb; color: #fff; font-size: 14px; font-weight: 500; padding: 12px 24px; border-radius: 8px; text-decoration: none;">View Reviews</a>
      <p style="color: #aaa; font-size: 12px; margin-top: 32px;">Synapse3P · automated weekly cadence check</p>
    </div>
  `
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/review-cadence-check] CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Find all active orgs ──────────────────────────────────────────────────
  const orgs = await prisma.organisation.findMany({
    select: { id: true, name: true },
  })

  let totalOverdue = 0
  let notified     = false

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

  for (const org of orgs) {
    try {
      const dueEntities = await getEntitiesDueForReview(org.id, prisma)
      if (dueEntities.length === 0) continue

      totalOverdue += dueEntities.length

      // 1. Create EntityActivityLog entry for each overdue entity
      for (const entity of dueEntities) {
        const lastReviewStr = entity.lastReviewAt
          ? `last review ${entity.daysOverdue + entity.cadenceDays} days ago`
          : 'never reviewed'

        await prisma.entityActivityLog.create({
          data: {
            entityId:      entity.entityId,
            orgId:         org.id,
            activityType:  'REVIEW',
            title:         'Periodic review overdue',
            description:   `Periodic review overdue — ${lastReviewStr} (cadence: ${entity.cadenceDays}d, overdue: ${entity.daysOverdue}d)`,
            referenceType: 'ReviewCadenceCheck',
            performedBy:   'system',
            occurredAt:    new Date(),
          },
        })
      }

      // 2. Send one summary email per org to FINANCE_MANAGER and CONTROLLER
      if (resend) {
        const recipients = await prisma.user.findMany({
          where: {
            orgId: org.id,
            role:  { in: ['FINANCE_MANAGER', 'CONTROLLER'] },
            emailVerified: true,
          },
          select: { email: true },
        })

        const toAddresses = recipients.map(u => u.email)
        if (toAddresses.length > 0) {
          await resend.emails.send({
            from:    FROM,
            to:      toAddresses,
            subject: `[${org.name}] ${dueEntities.length} vendor review${dueEntities.length !== 1 ? 's' : ''} overdue`,
            html:    buildOverdueEmail(dueEntities),
          })
          notified = true
        }
      }
    } catch (err) {
      console.error(`[cron/review-cadence-check] error processing org ${org.id}`, err)
    }
  }

  console.log(`[cron/review-cadence-check] totalOverdue=${totalOverdue} notified=${notified}`)

  void writeAuditEvent(prisma, {
    actorId:    'cron',
    orgId:      'system',
    action:     'CRON_RUN',
    objectType: 'SYSTEM',
    objectId:   'cron:review-cadence-check',
    after:      { cronName: 'review-cadence-check', overdueCount: totalOverdue, notified },
  })

  return NextResponse.json({ overdueCount: totalOverdue, notified })
}
