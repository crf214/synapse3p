// src/app/api/portal/invoices/[id]/route.ts
// GET — full invoice detail for portal vendors/clients

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { supabaseAdmin } from '@/lib/supabase'

const PORTAL_ROLES   = new Set(['VENDOR', 'CLIENT'])
const INVOICE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? process.env.INVOICES_BUCKET ?? 'synapse3p-files'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    // Verify the invoice belongs to the portal user's entity
    const rel = await prisma.entityOrgRelationship.findFirst({
      where: { portalUserId: session.userId },
    })
    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    const invoice = await prisma.invoice.findFirst({
      where:   { id: params.id, entityId: rel.entityId, orgId: rel.orgId },
      include: {
        extractedFields: {
          where:   { confidence: { gte: 0.6 } },
          orderBy: { fieldName: 'asc' },
          select:  { fieldName: true, normalizedValue: true, reviewedValue: true, confidence: true },
        },
        ingestionEvent: { select: { storageRef: true } },
        decision:       { select: { decision: true, decidedAt: true } },
      },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    // Signed PDF URL (1-hour expiry)
    let pdfSignedUrl: string | null = null
    if (invoice.ingestionEvent?.storageRef) {
      const { data } = await supabaseAdmin.storage
        .from(INVOICE_BUCKET)
        .createSignedUrl(invoice.ingestionEvent.storageRef, 3600)
      pdfSignedUrl = data?.signedUrl ?? null
    }

    // Supporting documents uploaded by portal (source = VENDOR, metadata.invoiceId = id)
    const documents = await prisma.document.findMany({
      where: {
        orgId:    rel.orgId,
        entityId: rel.entityId,
        source:   'VENDOR',
        metadata: { path: ['invoiceId'], equals: params.id },
      },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, title: true, docType: true, mimeType: true, fileSizeBytes: true, createdAt: true },
    })

    // Vendor disputes from activity log
    const disputes = await prisma.entityActivityLog.findMany({
      where: {
        orgId:         rel.orgId,
        entityId:      rel.entityId,
        referenceId:   params.id,
        referenceType: 'Invoice',
        activityType:  'NOTE',
        metadata:      { path: ['type'], equals: 'VENDOR_DISPUTE' },
      },
      orderBy: { occurredAt: 'desc' },
      select:  { id: true, title: true, description: true, occurredAt: true, metadata: true },
    })

    return NextResponse.json({
      invoice: {
        id:          invoice.id,
        invoiceNo:   invoice.invoiceNo,
        amount:      Number(invoice.amount),
        currency:    invoice.currency,
        invoiceDate: invoice.invoiceDate?.toISOString() ?? null,
        dueDate:     invoice.dueDate?.toISOString()     ?? null,
        status:      invoice.status,
        source:      invoice.source,
        pdfSignedUrl,
        extractedFields: invoice.extractedFields.map(f => ({
          fieldName:    f.fieldName,
          value:        f.reviewedValue ?? f.normalizedValue ?? '',
          confidence:   f.confidence,
        })),
        decision: invoice.decision
          ? { decision: invoice.decision.decision, decidedAt: invoice.decision.decidedAt }
          : null,
      },
      documents: documents.map(d => ({
        id:        d.id,
        title:     d.title,
        docType:   d.docType,
        mimeType:  d.mimeType,
        sizeBytes: d.fileSizeBytes,
        createdAt: d.createdAt.toISOString(),
      })),
      disputes: disputes.map(d => ({
        id:          d.id,
        title:       d.title,
        description: d.description,
        occurredAt:  d.occurredAt.toISOString(),
        disputeType: (d.metadata as Record<string, unknown>)?.disputeType as string ?? 'OTHER',
        status:      (d.metadata as Record<string, unknown>)?.status as string ?? 'OPEN',
      })),
    })
  } catch (err) {
    return handleApiError(err, `GET /api/portal/invoices/${params.id}`)
  }
}
