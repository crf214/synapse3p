// src/app/api/external-signals/route.ts
// GET — paginated incoming signal feed with type/severity/dismissed filters
//
// Status check (2.17):
//   ExternalSignal creation:           no  — signals are created by the nightly batch (scripts/external-signals.ts),
//                                           not via a manual POST. No POST handler exists in this file.
//   Review workflow (status transitions): yes — PUT /api/external-signals/[id] sets reviewedBy/reviewedAt
//                                           when dismissed is toggled; the [id] route was extended (2.18) to
//                                           treat dismissed=false + reviewedBy set as "confirmed" and trigger
//                                           risk recomputation for HIGH/CRITICAL signals.
//   Dismiss workflow:                  yes — PUT /api/external-signals/[id] accepts { dismissed: boolean }
//                                           and writes reviewedBy + reviewedAt.
//
// TODO Phase 5: wire automated news/stock ingestion scripts here

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'

const ALLOWED_ROLES = new Set(['ADMIN', 'CISO', 'CONTROLLER', 'CFO', 'AUDITOR'])

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const { searchParams } = new URL(req.url)
    const page       = Math.max(1, Number(searchParams.get('page') ?? '1'))
    const pageSize   = 50
    const signalType = searchParams.get('type')      ?? ''
    const severity   = searchParams.get('severity')  ?? ''
    const dismissed  = searchParams.get('dismissed') ?? ''

    const where = {
      orgId: session.orgId!,
      ...(signalType ? { signalType: signalType as never }            : {}),
      ...(severity   ? { severity:   severity   as never }            : {}),
      ...(dismissed === 'true'  ? { dismissed: true }                 :
          dismissed === 'false' ? { dismissed: false }                : {}),
    }

    const [total, signals] = await Promise.all([
      prisma.externalSignal.count({ where }),
      prisma.externalSignal.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        include: { entity: { select: { id: true, name: true } } },
      }),
    ])

    // Batch-resolve reviewer names
    const reviewerIds = new Set(signals.map(s => s.reviewedBy).filter(Boolean) as string[])
    const reviewers = reviewerIds.size > 0
      ? await prisma.user.findMany({
          where:  { id: { in: [...reviewerIds] } },
          select: { id: true, name: true, email: true },
        })
      : []
    const reviewerMap = Object.fromEntries(reviewers.map(u => [u.id, u]))

    return NextResponse.json({
      signals: signals.map(s => ({
        id:               s.id,
        signalType:       s.signalType,
        severity:         s.severity,
        title:            s.title,
        summary:          s.summary,
        sourceUrl:        s.sourceUrl,
        sourceName:       s.sourceName,
        publishedAt:      s.publishedAt?.toISOString()  ?? null,
        detectedAt:       s.detectedAt.toISOString(),
        dismissed:        s.dismissed,
        affectedRiskScore: s.affectedRiskScore,
        reviewedAt:       s.reviewedAt?.toISOString()   ?? null,
        reviewer:         s.reviewedBy ? (reviewerMap[s.reviewedBy] ?? null) : null,
        entity:           s.entity,
      })),
      total,
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/external-signals')
  }
}
