// src/app/api/invoices/upload/route.ts
// PDF file upload ingestion endpoint.
// Accepts multipart/form-data with a `file` field (PDF only), optional
// `entityId`, `invoiceNo`, and `amount` hint fields.

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, ValidationError } from '@/lib/errors'
import { supabaseAdmin } from '@/lib/supabase'
import { computeFingerprint, checkPreExtractionDuplicates, runInvoicePipeline } from '@/lib/invoice-pipeline'
import { writeAuditEvent } from '@/lib/audit'
import { WorkflowEngine, selectTemplate } from '@/lib/workflow-engine'

const ALLOWED_ROLES  = new Set(['ADMIN', 'AP_CLERK', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const INVOICE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? process.env.INVOICES_BUCKET ?? 'synapse3p-files'
const MAX_SIZE_BYTES = 20 * 1024 * 1024   // 20 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const formData = await req.formData()
    const file     = formData.get('file')
    const entityId = formData.get('entityId')?.toString() ?? null
    const invoiceNoHint = formData.get('invoiceNo')?.toString() ?? null
    const amountHint    = formData.get('amount')?.toString() ?? null

    if (!(file instanceof File)) throw new ValidationError('file is required')
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new ValidationError('Only PDF files are accepted')
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new ValidationError(`File too large. Maximum size is ${MAX_SIZE_BYTES / 1024 / 1024} MB`)
    }

    // Validate entityId if provided
    if (entityId) {
      const entity = await prisma.entity.findFirst({
        where: { id: entityId, masterOrgId: session.orgId },
      })
      if (!entity) throw new ValidationError('Entity not found')
    }

    // Read bytes and compute fingerprint
    const arrayBuffer   = await file.arrayBuffer()
    const buffer        = Buffer.from(arrayBuffer)

    // Validate PDF magic bytes (%PDF) — prevents MIME-type spoofing.
    // The PDF spec allows the header to appear within the first 1024 bytes.
    const pdfHeader = Buffer.from('%PDF')
    const searchWindow = buffer.slice(0, 1024)
    if (!searchWindow.includes(pdfHeader)) {
      throw new ValidationError('File content does not match a valid PDF')
    }
    const pdfFingerprint = computeFingerprint(buffer)
    const pdfBase64      = buffer.toString('base64')

    // Pre-extraction duplicate check (fingerprint)
    const duplicateOf = await checkPreExtractionDuplicates({
      orgId:          session.orgId,
      emailMessageId: null,
      pdfFingerprint,
    })

    // Upload to Supabase Storage regardless (for audit purposes)
    const safeName   = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${session.orgId}/invoices/${Date.now()}-${safeName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(INVOICE_BUCKET)
      .upload(storagePath, buffer, { upsert: false, contentType: 'application/pdf' })

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    // Create ingestion event
    const ingestionEvent = await prisma.invoiceIngestionEvent.create({
      data: {
        orgId:           session.orgId,
        source:          'PORTAL',
        storageRef:      storagePath,
        uploadedBy:      session.userId,
        processingStatus: 'PENDING',
        attachmentRefs:  [{ filename: file.name, storageRef: storagePath, mimeType: 'application/pdf', sizeBytes: file.size }] as never,
      },
    })

    if (duplicateOf) {
      await prisma.invoiceIngestionEvent.update({
        where: { id: ingestionEvent.id },
        data:  { processingStatus: 'FAILED', errorDetails: `PDF fingerprint duplicate of invoice ${duplicateOf}` },
      })
      return NextResponse.json(
        { error: { message: 'A duplicate invoice with the same PDF content already exists', code: 'DUPLICATE', duplicateOf } },
        { status: 409 },
      )
    }

    // Resolve entityId — use provided, or auto-create a PROVISIONAL entity when none is supplied
    let resolvedEntityId: string
    let provisionalEntityCreated = false
    if (entityId) {
      resolvedEntityId = entityId
    } else {
      const result = await getOrCreateProvisionalEntity(session.orgId, null)
      resolvedEntityId = result.id
      provisionalEntityCreated = result.isNew
    }

    // Create draft invoice — status UNMATCHED when no entity was supplied
    const invoiceStatus = entityId ? 'RECEIVED' : 'UNMATCHED'
    const invoice = await prisma.invoice.create({
      data: {
        orgId:          session.orgId,
        invoiceNo:      invoiceNoHint ?? `UPLOAD-${Date.now()}`,
        entityId:       resolvedEntityId,
        amount:         amountHint ? parseFloat(amountHint) || 0 : 0,
        currency:       'USD',
        invoiceDate:    new Date(),
        status:         invoiceStatus,
        source:         'PORTAL',
        pdfFingerprint,
        documentId:     null,
      },
    })

    await prisma.invoiceIngestionEvent.update({
      where: { id: ingestionEvent.id },
      data:  { invoiceId: invoice.id, processingStatus: 'PARSED' },
    })

    await writeAuditEvent(prisma, {
      actorId:    session.userId!,
      orgId:      session.orgId!,
      action:     'CREATE',
      objectType: 'INVOICE',
      objectId:   invoice.id,
      after:      invoiceStatus === 'UNMATCHED' ? { status: 'UNMATCHED', provisionalEntityCreated } : undefined,
    })

    if (invoiceStatus === 'UNMATCHED') {
      await writeAuditEvent(prisma, {
        actorId:    session.userId!,
        orgId:      session.orgId!,
        action:     'UPDATE',
        objectType: 'ENTITY',
        objectId:   resolvedEntityId,
        after:      { provisionalLinked: true, invoiceId: invoice.id, reason: 'No entity supplied at upload time' },
      })
    }

    // Fire-and-forget workflow trigger (must not block invoice creation)
    void (async () => {
      try {
        const engine = new WorkflowEngine(prisma)
        const invoiceData = { invoice: { id: invoice.id, status: invoice.status, entityId: resolvedEntityId, orgId: session.orgId } }
        const templateId = await selectTemplate('OBJECT_CREATED', 'INVOICE', invoiceData, session.orgId!, prisma)
        if (templateId) {
          await engine.startWorkflow(templateId, 'INVOICE', invoice.id, session.orgId!, invoiceData)
        }
      } catch (err) {
        console.warn('[WorkflowEngine] Failed to start workflow for invoice upload:', err)
      }
    })()

    // Run pipeline asynchronously (don't block response)
    runInvoicePipeline({ invoiceId: invoice.id, orgId: session.orgId, pdfBase64 }).catch(err => {
      console.error('[invoices/upload] pipeline error:', err)
      prisma.invoiceIngestionEvent.update({
        where: { id: ingestionEvent.id },
        data:  { processingStatus: 'FAILED', errorDetails: String(err) },
      }).catch(() => {})
    })

    return NextResponse.json({ invoice: { id: invoice.id, status: invoice.status } }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/invoices/upload')
  }
}

async function getOrCreateProvisionalEntity(
  orgId: string,
  vendorName: string | null,
): Promise<{ id: string; isNew: boolean }> {
  const slug = `provisional-${orgId.slice(-6)}-${Date.now()}`
  // Try to find an existing unresolved PROVISIONAL entity for this org first
  const existing = await prisma.entity.findFirst({
    where: { masterOrgId: orgId, status: 'PROVISIONAL' },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { id: existing.id, isNew: false }
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
