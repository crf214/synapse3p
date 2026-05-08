// src/app/api/portal/invoices/[id]/documents/route.ts
// POST — vendor uploads a supporting document against an invoice

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { supabaseAdmin } from '@/lib/supabase'

const PORTAL_ROLES   = new Set(['VENDOR', 'CLIENT'])
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'synapse3p-files'
const MAX_SIZE_BYTES = 20 * 1024 * 1024   // 20 MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rel = await prisma.entityOrgRelationship.findFirst({
      where: { portalUserId: session.userId },
    })
    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, entityId: rel.entityId, orgId: rel.orgId },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')

    const formData = await req.formData()
    const file  = formData.get('file')
    const title = formData.get('title')?.toString()?.trim() ?? ''

    if (!(file instanceof File)) throw new ValidationError('file is required')
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      throw new ValidationError('Unsupported file type. Accepted: PDF, images, Word, Excel')
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new ValidationError(`File too large. Maximum size is ${MAX_SIZE_BYTES / 1024 / 1024} MB`)
    }

    const buffer      = Buffer.from(await file.arrayBuffer())
    const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${rel.orgId}/portal-uploads/${params.id}/${Date.now()}-${safeName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { upsert: false, contentType: file.type })

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    const document = await prisma.document.create({
      data: {
        orgId:         rel.orgId,
        entityId:      rel.entityId,
        title:         title || file.name,
        docType:       'OTHER',
        source:        'VENDOR',
        storageRef:    storagePath,
        storageBucket: STORAGE_BUCKET,
        mimeType:      file.type,
        fileSizeBytes: file.size,
        uploadedBy:    session.userId,
        status:        'active',
        metadata: {
          invoiceId:        params.id,
          invoiceNo:        invoice.invoiceNo,
          uploadedViaPortal: true,
        },
      },
      select: { id: true, title: true, docType: true, mimeType: true, fileSizeBytes: true, createdAt: true },
    })

    return NextResponse.json({
      document: {
        id:        document.id,
        title:     document.title,
        docType:   document.docType,
        mimeType:  document.mimeType,
        sizeBytes: document.fileSizeBytes,
        createdAt: document.createdAt.toISOString(),
      },
    }, { status: 201 })
  } catch (err) {
    return handleApiError(err, `POST /api/portal/invoices/${params.id}/documents`)
  }
}
