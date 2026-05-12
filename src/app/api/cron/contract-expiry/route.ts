// src/app/api/cron/contract-expiry/route.ts
//
// Cron job — checks all active contracts for upcoming expiry.
// Urgency tiers:
//   CRITICAL  ≤ 14 days
//   WARNING   15–30 days
//   NOTICE    31–90 days
//
// For each expiring contract:
//   1. Creates an EntityActivityLog entry on the linked entity
//   2. Sends one summary email per org to FINANCE_MANAGER, CONTROLLER, LEGAL
//
// Called by Vercel Cron every day at 09:00 UTC (see vercel.json).
//
// REQUIRED ENV VAR: CRON_SECRET

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeAuditEvent } from '@/lib/audit'
import { Resend } from 'resend'

const FROM    = process.env.RESEND_FROM_EMAIL ?? 'notifications@synapse3p.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

type Urgency = 'CRITICAL' | 'WARNING' | 'NOTICE'

interface ExpiringContract {
  id:          string
  contractNo:  string
  entityId:    string
  entityName:  string
  orgId:       string
  daysUntil:   number
  urgency:     Urgency
  trigger:     'endDate' | 'renewalDate'
}

function urgencyFor(days: number): Urgency {
  if (days <= 14) return 'CRITICAL'
  if (days <= 30) return 'WARNING'
  return 'NOTICE'
}

function buildSummaryEmail(
  orgName:   string,
  contracts: ExpiringContract[],
): string {
  const CRITICAL = contracts.filter(c => c.urgency === 'CRITICAL')
  const WARNING  = contracts.filter(c => c.urgency === 'WARNING')
  const NOTICE   = contracts.filter(c => c.urgency === 'NOTICE')

  function section(label: string, color: string, items: ExpiringContract[]) {
    if (items.length === 0) return ''
    const rows = items.map(c => `
      <tr>
        <td style="padding:8px 0;font-size:13px;color:#111;border-bottom:1px solid #f1f5f9;">${c.contractNo}</td>
        <td style="padding:8px 0;font-size:13px;color:#555;border-bottom:1px solid #f1f5f9;">${c.entityName}</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:${color};border-bottom:1px solid #f1f5f9;text-align:right;">
          ${c.daysUntil === 0 ? 'Today' : `${c.daysUntil}d`} · ${c.trigger === 'renewalDate' ? 'renewal' : 'expiry'}
        </td>
      </tr>`).join('')
    return `
      <div style="margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">${label}</div>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;">
      <div style="font-size:20px;font-weight:600;color:#111;margin-bottom:8px;">Contract Expiry Alert</div>
      <p style="color:#555;margin:0 0 24px;">
        ${contracts.length} contract${contracts.length !== 1 ? 's' : ''} in <strong>${orgName}</strong>
        require${contracts.length === 1 ? 's' : ''} attention.
      </p>
      ${section('⚠ Critical — ≤14 days', '#dc2626', CRITICAL)}
      ${section('Warning — 15–30 days',   '#d97706', WARNING)}
      ${section('Notice — 31–90 days',    '#2563eb', NOTICE)}
      <a href="${APP_URL}/dashboard/contracts"
        style="display:inline-block;background:#111;color:#fff;font-size:14px;font-weight:500;padding:12px 24px;border-radius:8px;text-decoration:none;">
        View Contracts
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px;">Synapse3P · automated daily contract expiry check</p>
    </div>`
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron/contract-expiry] CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now       = new Date()
  const in90Days  = new Date(now.getTime() + 90 * 86400_000)
  const in30Days  = new Date(now.getTime() + 30 * 86400_000)

  // ── Fetch all active/under-review contracts expiring within thresholds ───
  const contracts = await prisma.contract.findMany({
    where: {
      status: { in: ['ACTIVE', 'UNDER_REVIEW'] },
      OR: [
        { endDate:     { gte: now, lte: in90Days } },
        { renewalDate: { gte: now, lte: in30Days } },
      ],
    },
    select: {
      id:         true,
      contractNo: true,
      entityId:   true,
      orgId:      true,
      endDate:    true,
      renewalDate: true,
      notes:      true,
    },
  })

  if (contracts.length === 0) {
    void writeAuditEvent(prisma, {
      actorId:    'cron',
      orgId:      'system',
      action:     'CRON_RUN',
      objectType: 'SYSTEM',
      objectId:   'cron:contract-expiry',
      after:      { cronName: 'contract-expiry', critical: 0, warning: 0, notice: 0, notified: false },
    })
    return NextResponse.json({ critical: 0, warning: 0, notice: 0, notified: false })
  }

  // ── Fetch entity names ────────────────────────────────────────────────────
  const entityIds = [...new Set(contracts.map(c => c.entityId))]
  const entities  = await prisma.entity.findMany({
    where:  { id: { in: entityIds } },
    select: { id: true, name: true },
  })
  const entityMap = new Map(entities.map(e => [e.id, e.name]))

  // ── Fetch org names ───────────────────────────────────────────────────────
  const orgIds  = [...new Set(contracts.map(c => c.orgId))]
  const orgs    = await prisma.organisation.findMany({
    where:  { id: { in: orgIds } },
    select: { id: true, name: true },
  })
  const orgMap  = new Map(orgs.map(o => [o.id, o.name]))

  // ── Build expiring list (deduplicate: prioritise endDate) ─────────────────
  const expiringMap = new Map<string, ExpiringContract>()

  for (const c of contracts) {
    const entityName = entityMap.get(c.entityId) ?? 'Unknown'

    if (c.endDate && c.endDate >= now && c.endDate <= in90Days) {
      const days    = Math.ceil((c.endDate.getTime() - now.getTime()) / 86400_000)
      const urgency = urgencyFor(days)
      const existing = expiringMap.get(c.id)
      if (!existing || urgency === 'CRITICAL') {
        expiringMap.set(c.id, { id: c.id, contractNo: c.contractNo, entityId: c.entityId, entityName, orgId: c.orgId, daysUntil: days, urgency, trigger: 'endDate' })
      }
    }

    if (c.renewalDate && c.renewalDate >= now && c.renewalDate <= in30Days) {
      const days    = Math.ceil((c.renewalDate.getTime() - now.getTime()) / 86400_000)
      const urgency = urgencyFor(days)
      const existing = expiringMap.get(`${c.id}:renewal`)
      if (!existing) {
        expiringMap.set(`${c.id}:renewal`, { id: c.id, contractNo: c.contractNo, entityId: c.entityId, entityName, orgId: c.orgId, daysUntil: days, urgency, trigger: 'renewalDate' })
      }
    }
  }

  const expiring = [...expiringMap.values()]
  const critical = expiring.filter(c => c.urgency === 'CRITICAL').length
  const warning  = expiring.filter(c => c.urgency === 'WARNING').length
  const notice   = expiring.filter(c => c.urgency === 'NOTICE').length

  // ── Create EntityActivityLog entries ─────────────────────────────────────
  for (const c of expiring) {
    const triggerLabel = c.trigger === 'renewalDate' ? 'Renewal deadline' : 'Contract'
    const urgencyLabel = c.urgency === 'CRITICAL' ? '⚠ CRITICAL' : c.urgency === 'WARNING' ? 'WARNING' : 'NOTICE'
    await prisma.entityActivityLog.create({
      data: {
        entityId:      c.entityId,
        orgId:         c.orgId,
        activityType:  'DOCUMENT',
        title:         `${triggerLabel} expiring in ${c.daysUntil} day${c.daysUntil !== 1 ? 's' : ''}: ${c.contractNo}`,
        description:   `[${urgencyLabel}] ${triggerLabel} ${c.contractNo} expires in ${c.daysUntil} day${c.daysUntil !== 1 ? 's' : ''}`,
        referenceType: 'ContractExpiry',
        referenceId:   c.id,
        performedBy:   'system',
        occurredAt:    now,
      },
    }).catch(err => console.error('[cron/contract-expiry] activity log error', err))
  }

  // ── Send summary emails per org ───────────────────────────────────────────
  const resend   = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
  let notified   = false

  if (resend) {
    // Group by org
    const byOrg = new Map<string, ExpiringContract[]>()
    for (const c of expiring) {
      if (!byOrg.has(c.orgId)) byOrg.set(c.orgId, [])
      byOrg.get(c.orgId)!.push(c)
    }

    for (const [orgId, orgContracts] of byOrg) {
      try {
        const recipients = await prisma.user.findMany({
          where: {
            orgId,
            role: { in: ['FINANCE_MANAGER', 'CONTROLLER', 'LEGAL'] },
            emailVerified: true,
          },
          select: { email: true },
        })
        if (recipients.length === 0) continue

        const orgName = orgMap.get(orgId) ?? 'Your organisation'
        const criticalCount = orgContracts.filter(c => c.urgency === 'CRITICAL').length

        await resend.emails.send({
          from:    FROM,
          to:      recipients.map(r => r.email),
          subject: `[${orgName}] ${criticalCount > 0 ? `⚠ ${criticalCount} critical — ` : ''}${orgContracts.length} contract${orgContracts.length !== 1 ? 's' : ''} expiring soon`,
          html:    buildSummaryEmail(orgName, orgContracts),
        })
        notified = true
      } catch (err) {
        console.error(`[cron/contract-expiry] email error for org ${orgId}`, err)
      }
    }
  }

  console.log(`[cron/contract-expiry] critical=${critical} warning=${warning} notice=${notice} notified=${notified}`)

  void writeAuditEvent(prisma, {
    actorId:    'cron',
    orgId:      'system',
    action:     'CRON_RUN',
    objectType: 'SYSTEM',
    objectId:   'cron:contract-expiry',
    after:      { cronName: 'contract-expiry', critical, warning, notice, notified },
  })

  return NextResponse.json({ critical, warning, notice, notified })
}
