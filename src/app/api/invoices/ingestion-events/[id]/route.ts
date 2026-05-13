// src/app/api/invoices/ingestion-events/[id]/route.ts
// POST /replay — re-run the pipeline for a FAILED ingestion event

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { runInvoicePipeline } from '@/lib/invoice-pipeline'
import { supabaseAdmin } from '@/lib/supabase'
import { APPROVAL_ROLES } from '@/lib/security/roles'

const ALLOWED_ROLES = APPROVAL_ROLES
const INVOICE_BUCKET = process.env.INVOICES_BUCKET ?? 'invoices'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!ALLOWED_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const body = await req.json().catch(() => ({}))
    const action = body.action as string | undefined

    const { id } = await params
    const event = await prisma.invoiceIngestionEvent.findUnique({
      where: { id },
      include: { invoice: true },
    })

    if (!event || event.orgId !== session.orgId) throw new NotFoundError('Ingestion event not found')

    // ── Replay ──────────────────────────────────────────────────────────────
    if (action === 'replay') {
      if (event.processingStatus !== 'FAILED') {
        return NextResponse.json({ error: 'Only FAILED events can be replayed' }, { status: 400 })
      }

      // Reset status
      await prisma.invoiceIngestionEvent.update({
        where: { id: event.id },
        data:  { processingStatus: 'PENDING', errorDetails: null },
      })

      // Reload or create a fresh draft invoice
      let invoiceId = event.invoiceId
      if (!invoiceId) {
        const attachments = (event.attachmentRefs as Array<{ filename: string; storageRef: string; mimeType: string }> | null) ?? []
        const entity = await prisma.entity.findFirst({
          where: { orgRelationships: { some: { orgId: event.orgId, activeForBillPay: true } } },
          select: { id: true },
        })
        const invoice = await prisma.invoice.create({
          data: {
            orgId:         event.orgId,
            invoiceNo:     `REPLAY-${Date.now()}`,
            entityId:      entity?.id ?? await getOrCreateUnknownEntity(event.orgId),
            amount:        0,
            currency:      'USD',
            invoiceDate:   new Date(),
            status:        'RECEIVED',
            source:        event.source,
            emailMessageId: event.emailMessageId,
          },
        })
        await prisma.invoiceIngestionEvent.update({
          where: { id: event.id },
          data:  { invoiceId: invoice.id },
        })
        invoiceId = invoice.id
      }

      // Attempt to reload PDF from storage for re-extraction
      let pdfBase64: string | undefined
      const attachments = (event.attachmentRefs as Array<{ filename: string; storageRef: string; mimeType: string }> | null) ?? []
      const firstPdf = attachments.find(a => a.mimeType === 'application/pdf')
      if (firstPdf?.storageRef) {
        const { data } = await supabaseAdmin.storage
          .from(INVOICE_BUCKET)
          .download(firstPdf.storageRef)
        if (data) {
          const buf = Buffer.from(await data.arrayBuffer())
          pdfBase64 = buf.toString('base64')
        }
      }

      try {
        await runInvoicePipeline({
          invoiceId,
          orgId:     event.orgId,
          pdfBase64,
        })
        await prisma.invoiceIngestionEvent.update({
          where: { id: event.id },
          data:  { processingStatus: 'PARSED' },
        })
      } catch (err) {
        await prisma.invoiceIngestionEvent.update({
          where: { id: event.id },
          data:  { processingStatus: 'FAILED', errorDetails: String(err) },
        })
        return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
      }

      return NextResponse.json({ ok: true, invoiceId })
    }

    // ── Dismiss ─────────────────────────────────────────────────────────────
    if (action === 'dismiss') {
      await prisma.invoiceIngestionEvent.update({
        where: { id: event.id },
        data:  { processingStatus: 'DISMISSED', errorDetails: event.errorDetails ?? 'Dismissed by user' },
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return handleApiError(err, 'POST /api/invoices/ingestion-events/[id]')
  }
}

async function getOrCreateUnknownEntity(orgId: string): Promise<string> {
  const slug = `unknown-vendor-${orgId.slice(-6)}`
  const existing = await prisma.entity.findFirst({ where: { slug } })
  if (existing) return existing.id
  const entity = await prisma.entity.create({
    data: {
      masterOrgId:    orgId,
      name:           'Unknown Vendor',
      slug,
      legalStructure: 'OTHER',
      status:         'PENDING_REVIEW',
    },
  })
  return entity.id
}
