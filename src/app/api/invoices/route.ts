// src/app/api/invoices/route.ts — GET (list with filters and pagination)

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError } from '@/lib/errors'
import { Prisma } from '@prisma/client'
import { sanitiseString } from '@/lib/security/sanitise'

const READ_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const DEFAULT_LIMIT = 50
const MAX_LIMIT     = 100

const VALID_STATUSES = new Set(['RECEIVED', 'MATCHED', 'UNMATCHED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED', 'DUPLICATE'])
const VALID_TIERS    = new Set(['LOW', 'MEDIUM', 'HIGH'])

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const sp        = req.nextUrl.searchParams
    const page      = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit     = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
    const status    = sanitiseString(sp.get('status') ?? '', 50).trim() || null
    const tier      = sanitiseString(sp.get('tier') ?? '', 20).trim() || null
    const entityId  = sanitiseString(sp.get('entityId') ?? '', 50).trim() || null
    const source    = sanitiseString(sp.get('source') ?? '', 20).trim() || null
    const dateFrom  = sp.get('dateFrom') || null
    const dateTo    = sp.get('dateTo') || null

    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: { message: 'Invalid status filter', code: 'VALIDATION_ERROR' } }, { status: 400 })
    }
    if (tier && !VALID_TIERS.has(tier)) {
      return NextResponse.json({ error: { message: 'Invalid tier filter', code: 'VALIDATION_ERROR' } }, { status: 400 })
    }

    // Build where clause — exclude DUPLICATE status from main queue (quarantine has its own endpoint)
    const where: Prisma.InvoiceWhereInput = {
      orgId: session.orgId,
      ...(status ? { status: status as never } : { status: { not: 'DUPLICATE' as never } }),
      ...(entityId ? { entityId } : {}),
      ...(source   ? { source: source as never } : {}),
      ...(dateFrom || dateTo ? {
        invoiceDate: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo   ? { lte: new Date(dateTo) }   : {}),
        },
      } : {}),
      // Filter by risk tier via latest RiskEvaluation
      ...(tier ? {
        riskEvaluations: {
          some: { tier: tier as never },
        },
      } : {}),
    }

    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
        include: {
          entity: { select: { id: true, name: true, slug: true } },
          riskEvaluations: {
            orderBy: { evaluatedAt: 'desc' },
            take:    1,
            select:  { tier: true, overallScore: true, flags: true, evaluatedAt: true },
          },
          decision: { select: { decision: true, decidedAt: true } },
          approvals: {
            where: { status: 'PENDING' },
            take:  1,
            include: { assignee: { select: { name: true, email: true } } },
          },
          extractedFields: {
            where:  { needsReview: true },
            select: { fieldName: true },
          },
          _count: { select: { duplicateFlags: true } },
        },
      }),
    ])

    const data = invoices.map(inv => ({
      id:              inv.id,
      invoiceNo:       inv.invoiceNo,
      entityId:        inv.entityId,
      entityName:      inv.entity.name,
      amount:          inv.amount,
      currency:        inv.currency,
      invoiceDate:     inv.invoiceDate,
      dueDate:         inv.dueDate,
      status:          inv.status,
      source:          inv.source,
      isRecurring:     inv.isRecurring,
      createdAt:       inv.createdAt,
      riskTier:        inv.riskEvaluations[0]?.tier ?? null,
      riskScore:       inv.riskEvaluations[0]?.overallScore ?? null,
      riskFlags:       inv.riskEvaluations[0]?.flags ?? [],
      decision:        inv.decision?.decision ?? null,
      pendingApprover: inv.approvals[0]?.assignee ?? null,
      needsReviewCount: inv.extractedFields.length,
      duplicateFlagCount: inv._count.duplicateFlags,
    }))

    return NextResponse.json({
      invoices: data,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasNext:    page * limit < total,
        hasPrev:    page > 1,
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices')
  }
}
