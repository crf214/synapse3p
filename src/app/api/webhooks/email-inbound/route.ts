// src/app/api/webhooks/email-inbound/route.ts
// Resend inbound email webhook. Parses the incoming email, creates an
// InvoiceIngestionEvent and a draft Invoice, then runs the full pipeline.
//
// Security: Verifies the Resend/svix HMAC signature on every request.
// Required env var: RESEND_WEBHOOK_SECRET (signing secret from Resend dashboard).

import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { prisma } from '@/lib/prisma'
import { computeFingerprint, checkPreExtractionDuplicates, runInvoicePipeline } from '@/lib/invoice-pipeline'
import { supabaseAdmin } from '@/lib/supabase'
import { writeAuditEvent } from '@/lib/audit'
import { WorkflowEngine, selectTemplate } from '@/lib/workflow-engine'

const INVOICE_BUCKET = process.env.INVOICES_BUCKET ?? 'invoices'

// ---------------------------------------------------------------------------
// Resend inbound email payload shape (defensive — handle minor variations)
// ---------------------------------------------------------------------------
interface ResendInboundAttachment {
  filename?:    string
  name?:        string
  content?:     string   // base64
  data?:        string   // base64 (alternate key)
  type?:        string
  contentType?: string
}

interface ResendInboundPayload {
  from?:        string
  to?:          string | string[]
  subject?:     string
  html?:        string
  text?:        string
  headers?:     Record<string, string | string[]> | Array<{ name: string; value: string }>
  attachments?: ResendInboundAttachment[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessageId(headers: ResendInboundPayload['headers']): string | null {
  if (!headers) return null

  if (Array.isArray(headers)) {
    const h = headers.find(h => h.name.toLowerCase() === 'message-id')
    return h?.value ?? null
  }

  const val = headers['message-id'] ?? headers['Message-Id'] ?? headers['Message-ID']
  if (Array.isArray(val)) return val[0] ?? null
  return val ?? null
}

function extractPlusSlug(to: string | string[] | undefined): string | null {
  // invoices+entityslug@domain.com → 'entityslug'
  const toStr = Array.isArray(to) ? to[0] : to
  if (!toStr) return null
  const match = toStr.match(/invoices\+([^@]+)@/)
  return match?.[1] ?? null
}

function getAttachmentContent(a: ResendInboundAttachment): string | null {
  return a.content ?? a.data ?? null
}

function getAttachmentMime(a: ResendInboundAttachment): string {
  return a.type ?? a.contentType ?? 'application/octet-stream'
}

function getAttachmentName(a: ResendInboundAttachment): string {
  return a.filename ?? a.name ?? 'attachment'
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // H8: Verify Resend/svix HMAC signature before processing any payload.
  // RESEND_WEBHOOK_SECRET is the signing secret from the Resend webhook dashboard.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[email-inbound] RESEND_WEBHOOK_SECRET is not configured — rejecting all webhook requests')
    return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 })
  }

  const rawBody = await req.text()
  const svixHeaders = {
    'svix-id':        req.headers.get('svix-id')        ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }

  const wh = new Webhook(webhookSecret)
  try {
    wh.verify(rawBody, svixHeaders)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: ResendInboundPayload
  try {
    payload = JSON.parse(rawBody) as ResendInboundPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const messageId  = extractMessageId(payload.headers)
  const plusSlug   = extractPlusSlug(payload.to)
  const fromEmail  = payload.from ?? null
  const fromName   = fromEmail?.match(/^([^<]+)</)?.[1]?.trim() ?? null
  const subject    = payload.subject ?? null
  const emailText  = payload.text ?? null

  // ---------------------------------------------------------------------------
  // Resolve orgId from inbound address slug or fail gracefully.
  // In production, routing should include an org-specific subdomain or identifier.
  // For now, look up any org that has the plus-addressed entity slug.
  // ---------------------------------------------------------------------------
  let orgId   = ''
  let entityId: string | null = null

  if (plusSlug) {
    const entity = await prisma.entity.findFirst({
      where: { slug: plusSlug },
      include: { orgRelationships: { where: { activeForBillPay: true }, take: 1 } },
    })
    if (entity) {
      entityId = entity.id
      orgId = entity.orgRelationships[0]?.orgId ?? entity.masterOrgId
    }
  }

  // Fall through: if we can't resolve an org, reject the webhook
  if (!orgId) {
    // Create a minimal ingestion event in the first available org (or drop)
    console.warn('[email-inbound] Could not resolve orgId from plus-address slug:', plusSlug)
    return NextResponse.json({ received: true, status: 'unroutable' })
  }

  // Pre-extraction duplicate check on messageId
  const existingId = await checkPreExtractionDuplicates({
    orgId,
    emailMessageId: messageId,
    pdfFingerprint: null,  // no PDF yet at this stage
  })

  // Collect PDF attachments
  const pdfAttachments = (payload.attachments ?? []).filter(a => {
    const mime = getAttachmentMime(a)
    const name = getAttachmentName(a)
    return mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  })

  const attachmentRefs: Array<{ filename: string; storageRef: string; mimeType: string }> = []
  let firstPdfBase64: string | null = null
  let pdfFingerprint: string | null = null
  let documentId:     string | null = null

  // Upload PDF attachments to Supabase Storage
  for (const att of pdfAttachments) {
    const b64     = getAttachmentContent(att)
    if (!b64) continue

    const buffer  = Buffer.from(b64, 'base64')
    const fp      = computeFingerprint(buffer)
    const safeName = getAttachmentName(att).replace(/[^a-zA-Z0-9._-]/g, '_')
    const path    = `${orgId}/invoices/${Date.now()}-${safeName}`

    const { error } = await supabaseAdmin.storage
      .from(INVOICE_BUCKET)
      .upload(path, buffer, { upsert: false, contentType: 'application/pdf' })

    if (error) {
      console.error('[email-inbound] Supabase upload failed:', error.message)
      continue
    }

    attachmentRefs.push({ filename: getAttachmentName(att), storageRef: path, mimeType: 'application/pdf' })

    if (!firstPdfBase64) {
      firstPdfBase64  = b64
      pdfFingerprint  = fp
    }
  }

  // Create ingestion event
  const ingestionEvent = await prisma.invoiceIngestionEvent.create({
    data: {
      orgId,
      source:          'EMAIL',
      emailMessageId:  messageId,
      fromEmail,
      fromName,
      subject,
      attachmentRefs:  attachmentRefs as never,
      processingStatus: 'PENDING',
    },
  })

  // If already a duplicate, mark and exit
  if (existingId) {
    await prisma.invoiceIngestionEvent.update({
      where: { id: ingestionEvent.id },
      data:  { processingStatus: 'FAILED', errorDetails: `Duplicate of invoice ${existingId}` },
    })
    return NextResponse.json({ received: true, status: 'duplicate', duplicateOf: existingId })
  }

  // Also check pdfFingerprint
  if (pdfFingerprint) {
    const fpDup = await checkPreExtractionDuplicates({ orgId, emailMessageId: null, pdfFingerprint })
    if (fpDup) {
      await prisma.invoiceIngestionEvent.update({
        where: { id: ingestionEvent.id },
        data:  { processingStatus: 'FAILED', errorDetails: `PDF fingerprint duplicate of invoice ${fpDup}` },
      })
      return NextResponse.json({ received: true, status: 'duplicate', duplicateOf: fpDup })
    }
  }

  // Resolve entityId — use matched entity, or auto-create a PROVISIONAL entity
  let resolvedEntityId: string
  let provisionalEntityCreated = false
  if (entityId) {
    resolvedEntityId = entityId
  } else {
    const vendorName = fromName ?? fromEmail ?? null
    const result = await getOrCreateProvisionalEntity(orgId, vendorName)
    resolvedEntityId = result.id
    provisionalEntityCreated = result.isNew
  }

  // Status UNMATCHED when no entity was identified from the inbound address
  const invoiceStatus = entityId ? 'RECEIVED' : 'UNMATCHED'

  // Create draft invoice
  const invoice = await prisma.invoice.create({
    data: {
      orgId,
      invoiceNo:      `DRAFT-${Date.now()}`,  // will be overwritten by AI extraction
      entityId:       resolvedEntityId,
      amount:         0,
      currency:       'USD',
      invoiceDate:    new Date(),
      status:         invoiceStatus,
      source:         'EMAIL',
      emailMessageId: messageId,
      pdfFingerprint,
      documentId,
    },
  })

  // Link ingestion event → invoice
  await prisma.invoiceIngestionEvent.update({
    where: { id: ingestionEvent.id },
    data:  { invoiceId: invoice.id, processingStatus: 'PARSED' },
  })

  await writeAuditEvent(prisma, {
    actorId:    'system',
    orgId,
    action:     'CREATE',
    objectType: 'INVOICE',
    objectId:   invoice.id,
    after:      invoiceStatus === 'UNMATCHED' ? { status: 'UNMATCHED', provisionalEntityCreated } : undefined,
  })

  if (invoiceStatus === 'UNMATCHED') {
    await writeAuditEvent(prisma, {
      actorId:    'system',
      orgId,
      action:     'UPDATE',
      objectType: 'ENTITY',
      objectId:   resolvedEntityId,
      after:      { provisionalLinked: true, invoiceId: invoice.id, reason: 'No entity match from inbound email address' },
    })
  }

  // Fire-and-forget workflow trigger (must not block webhook response)
  void (async () => {
    try {
      const engine = new WorkflowEngine(prisma)
      const invoiceData = { invoice: { id: invoice.id, status: invoiceStatus, entityId: resolvedEntityId, orgId } }
      const templateId = await selectTemplate('OBJECT_CREATED', 'INVOICE', invoiceData, orgId, prisma)
      if (templateId) {
        await engine.startWorkflow(templateId, 'INVOICE', invoice.id, orgId, invoiceData)
      }
    } catch (err) {
      console.warn('[WorkflowEngine] Failed to start workflow for email-inbound invoice:', err)
    }
  })()

  // Run pipeline (synchronous — see note in docs about serverless timeout)
  try {
    await runInvoicePipeline({
      invoiceId:  invoice.id,
      orgId,
      pdfBase64:  firstPdfBase64 ?? undefined,
      emailText:  emailText ?? undefined,
    })
  } catch (err) {
    console.error('[email-inbound] pipeline error:', err)
    await prisma.invoiceIngestionEvent.update({
      where: { id: ingestionEvent.id },
      data:  { processingStatus: 'FAILED', errorDetails: String(err) },
    })
  }

  return NextResponse.json({ received: true, invoiceId: invoice.id })
}

// ---------------------------------------------------------------------------
// Get or create a PROVISIONAL entity for unresolved sender.
// Re-uses the most recent PROVISIONAL entity for the org to avoid proliferation.
// ---------------------------------------------------------------------------
async function getOrCreateProvisionalEntity(
  orgId: string,
  vendorName: string | null,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.entity.findFirst({
    where:   { masterOrgId: orgId, status: 'PROVISIONAL' },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { id: existing.id, isNew: false }

  const slug   = `provisional-${orgId.slice(-6)}-${Date.now()}`
  const entity = await prisma.entity.create({
    data: {
      masterOrgId:    orgId,
      name:           vendorName ?? 'Unknown Vendor (Provisional)',
      slug,
      legalStructure: 'OTHER',
      status:         'PROVISIONAL',
    },
  })
  return { id: entity.id, isNew: true }
}
