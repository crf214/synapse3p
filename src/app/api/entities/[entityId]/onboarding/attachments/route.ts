import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { supabaseAdmin } from '@/lib/supabase'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'

const BUCKET = process.env.ENTITY_DOCS_BUCKET ?? 'contracts'

const ALLOWED_ROLES  = new Set(['ADMIN', 'LEGAL', 'CISO', 'FINANCE_MANAGER', 'CONTROLLER', 'CFO'])
const ALLOWED_MIME   = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg'])
const MAX_BYTES      = 20 * 1024 * 1024 // 20 MB

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const docs = await prisma.document.findMany({
      where: {
        orgId:    session.orgId,
        entityId: entityId,
        metadata: { path: ['onboardingStep'], equals: 2 },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id:           true,
        title:        true,
        docType:      true,
        mimeType:     true,
        fileSizeBytes: true,
        storageRef:   true,
        storageBucket: true,
        uploadedBy:   true,
        createdAt:    true,
        metadata:     true,
      },
    })

    // Attach signed URLs (60-minute expiry)
    const docsWithUrls = await Promise.all(docs.map(async d => {
      const { data } = await supabaseAdmin.storage.from(d.storageBucket).createSignedUrl(d.storageRef, 3600)
      return { ...d, downloadUrl: data?.signedUrl ?? null }
    }))

    return NextResponse.json({ documents: docsWithUrls })
  } catch (err) {
    return handleApiError(err, 'GET /api/entities/[entityId]/onboarding/attachments')
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params

    const entity = await prisma.entity.findFirst({
      where:  { id: entityId, masterOrgId: session.orgId },
      select: { id: true },
    })
    if (!entity) throw new NotFoundError('Entity not found')

    const formData = await req.formData()
    const file     = formData.get('file')
    const docType  = (formData.get('docType') as string | null) ?? 'CONTRACT'
    const title    = (formData.get('title')   as string | null) ?? ''

    if (!(file instanceof File)) throw new ValidationError('No file provided')
    if (!ALLOWED_MIME.has(file.type)) {
      throw new ValidationError('File type not allowed. Upload PDF, DOC, DOCX, PNG, or JPEG.')
    }
    if (file.size > MAX_BYTES) throw new ValidationError('File exceeds 20 MB limit')

    const validDocTypes = ['CONTRACT', 'COMPLIANCE', 'CERTIFICATE', 'APPROVAL', 'OTHER']
    if (!validDocTypes.includes(docType)) throw new ValidationError('Invalid docType')

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${session.orgId}/${entityId}/onboarding/${Date.now()}-${safeName}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        upsert:      false,
        contentType: file.type,
      })

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    const docTitle = title.trim() || file.name

    const doc = await prisma.document.create({
      data: {
        orgId:         session.orgId,
        entityId:      entityId,
        title:         docTitle,
        docType:       docType as never,
        storageRef:    storagePath,
        storageBucket: BUCKET,
        mimeType:      file.type,
        fileSizeBytes: file.size,
        uploadedBy:    session.userId,
        metadata:      { onboardingStep: 2, uploadedByRole: session.role },
      },
    })

    return NextResponse.json({ document: doc }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST /api/entities/[entityId]/onboarding/attachments')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const session = await getSession()
    if (!session.userId || !session.orgId) throw new UnauthorizedError()
    if (!session.role || !ALLOWED_ROLES.has(session.role)) throw new ForbiddenError()

    const { entityId } = await params
    const { searchParams } = new URL(req.url)
    const docId = searchParams.get('docId')
    if (!docId) throw new ValidationError('docId is required')

    const doc = await prisma.document.findFirst({
      where: { id: docId, orgId: session.orgId, entityId },
    })
    if (!doc) throw new NotFoundError('Document not found')

    // Only ADMIN or the uploader may delete
    if (session.role !== 'ADMIN' && doc.uploadedBy !== session.userId) {
      throw new ForbiddenError('You can only delete documents you uploaded')
    }

    await supabaseAdmin.storage.from(doc.storageBucket).remove([doc.storageRef])
    await prisma.document.delete({ where: { id: docId } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'DELETE /api/entities/[entityId]/onboarding/attachments')
  }
}
