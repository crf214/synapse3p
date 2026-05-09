// src/app/api/invoices/[id]/route.ts — GET single invoice detail + PUT field corrections

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { sanitiseString } from '@/lib/security/sanitise'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditEvent } from '@/lib/audit'

const UpdateInvoiceSchema = z.object({
  fieldCorrections: z.array(z.object({
    fieldName:     z.string(),
    reviewedValue: z.string(),
  })).optional(),
  invoiceNo:   z.string().optional(),
  contractId:  z.string().nullable().optional(),
  notes:       z.string().optional(),
})

const READ_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO', 'AUDITOR'])
const WRITE_ROLES = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const INVOICE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? process.env.INVOICES_BUCKET ?? 'synapse3p-files'

// ---------------------------------------------------------------------------
// GET — full invoice detail
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !READ_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where: { id, orgId: session.orgId },
      include: {
        entity: {
          include: {
            financial:   true,
            dueDiligence: true,
            orgRelationships: { where: { orgId: session.orgId }, take: 1 },
          },
        },
        contract:        { select: { id: true, contractNo: true, status: true, value: true, currency: true, endDate: true, type: true } },
        extractedFields: { orderBy: { fieldName: 'asc' } },
        riskEvaluations: {
          orderBy: { evaluatedAt: 'desc' },
          take:    1,
          include: { signals: true },
        },
        decision:        true,
        approvals:       {
          orderBy: { assignedAt: 'desc' },
          include: { assignee: { select: { id: true, name: true, email: true, role: true } } },
        },
        duplicateFlags:  {
          include: {
            duplicateOf: { select: { id: true, invoiceNo: true, amount: true, invoiceDate: true } },
          },
        },
        ingestionEvent:  true,
        mergedAuthItem:  { include: { mergedAuth: { select: { id: true, reference: true, status: true } } } },
      },
    })

    if (!invoice) throw new NotFoundError('Invoice not found')

    // Generate signed URL for PDF viewer (1-hour expiry)
    let pdfSignedUrl: string | null = null
    if (invoice.ingestionEvent?.storageRef) {
      const { data } = await supabaseAdmin.storage
        .from(INVOICE_BUCKET)
        .createSignedUrl(invoice.ingestionEvent.storageRef, 3600)
      pdfSignedUrl = data?.signedUrl ?? null
    }

    // Vendor spend history (last 12 months)
    // VendorSpendSnapshot replaced with direct query — snapshot table retained but no longer read
    type SpendRow = { period: string; totalAmount: string; invoiceCount: bigint }
    const rawSpend = await prisma.$queryRaw<SpendRow[]>`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "invoiceDate"), 'YYYY-MM') AS period,
        SUM(amount)::text                                        AS "totalAmount",
        COUNT(*)                                                 AS "invoiceCount"
      FROM invoices
      WHERE "orgId"       = ${session.orgId}
        AND "entityId"    = ${invoice.entityId}
        AND "invoiceDate" >= NOW() - INTERVAL '12 months'
        AND status        != 'DUPLICATE'
      GROUP BY DATE_TRUNC('month', "invoiceDate")
      ORDER BY DATE_TRUNC('month', "invoiceDate") ASC
    `
    const spendHistory = rawSpend.map(r => ({
      period:       r.period,
      totalAmount:  parseFloat(r.totalAmount),
      invoiceCount: Number(r.invoiceCount),
    }))

    const recentInvoices = await prisma.invoice.findMany({
        where:   { entityId: invoice.entityId, orgId: session.orgId, id: { not: invoice.id }, status: { not: 'DUPLICATE' } },
        orderBy: { invoiceDate: 'desc' },
        take:    5,
        select:  { id: true, invoiceNo: true, amount: true, currency: true, invoiceDate: true, status: true },
      })

    return NextResponse.json({
      invoice: {
        ...invoice,
        pdfSignedUrl,
        vendorContext: {
          spendHistory,
          recentInvoices,
        },
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET /api/invoices/[id]')
  }
}

// ---------------------------------------------------------------------------
// PUT — update extracted fields (human correction) and invoice meta
// ---------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !WRITE_ROLES.has(session.role)) throw new ForbiddenError()

    const { id } = await params
    const invoice = await prisma.invoice.findFirst({
      where: { id, orgId: session.orgId },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    const rawBody = await req.json()
    const parsed = UpdateInvoiceSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const body = parsed.data

    // Apply field corrections
    if (body.fieldCorrections?.length) {
      await Promise.all(
        body.fieldCorrections.map(fc =>
          prisma.invoiceExtractedField.updateMany({
            where: { invoiceId: invoice.id, fieldName: sanitiseString(fc.fieldName, 50) },
            data:  {
              reviewedValue: sanitiseString(fc.reviewedValue, 500),
              reviewedBy:    session.userId,
              reviewedAt:    new Date(),
              needsReview:   false,
            },
          }),
        ),
      )
    }

    // Patch invoice-level fields
    const updates: Parameters<typeof prisma.invoice.update>[0]['data'] = {}
    if (body.invoiceNo  !== undefined) updates.invoiceNo  = sanitiseString(body.invoiceNo, 100)
    if (body.contractId !== undefined) updates.contractId = body.contractId
    if (body.notes      !== undefined) updates.notes      = sanitiseString(body.notes, 2000)

    const changedKeys = [
      ...(body.fieldCorrections?.length ? ['fieldCorrections'] : []),
      ...Object.keys(updates),
    ]

    if (Object.keys(updates).length) {
      await prisma.$transaction(async (tx) => {
        await tx.invoice.update({ where: { id: invoice.id }, data: updates })
        await writeAuditEvent(tx, {
          actorId:    session.userId!,
          orgId:      session.orgId!,
          action:     'UPDATE',
          objectType: 'INVOICE',
          objectId:   invoice.id,
          after:      { changedFields: changedKeys },
        })
      })
    } else if (changedKeys.length) {
      await writeAuditEvent(prisma, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'UPDATE',
        objectType: 'INVOICE',
        objectId:   invoice.id,
        after:      { changedFields: changedKeys },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PUT /api/invoices/[id]')
  }
}
