// src/app/api/portal/documents/[id]/download/route.ts
// GET — returns a short-lived signed download URL for a portal document

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { supabaseAdmin } from '@/lib/supabase'
import { handleApiError, UnauthorizedError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { PORTAL_ROLES } from '@/lib/security/roles'

const SIGNED_TTL_S  = 300   // 5-minute signed URL

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession()
    if (!session.userId) throw new UnauthorizedError()
    if (!PORTAL_ROLES.has(session.role ?? '')) throw new ForbiddenError()

    const rel = await prisma.entityOrgRelationship.findFirst({
      where: { portalUserId: session.userId },
    })
    if (!rel) throw new NotFoundError('No entity linked to this portal account')

    const { id } = await params

    const doc = await prisma.document.findFirst({
      where:  { id, entityId: rel.entityId, orgId: rel.orgId, status: { not: 'deleted' as never } },
      select: { id: true, title: true, storageRef: true, storageBucket: true, mimeType: true },
    })
    if (!doc) throw new NotFoundError('Document not found')
    if (!doc.storageRef) {
      return NextResponse.json({ error: { message: 'No file attached to this document' } }, { status: 404 })
    }

    const bucket = doc.storageBucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? 'synapse3p-files'

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(doc.storageRef, SIGNED_TTL_S)

    if (error || !data?.signedUrl) {
      console.error('[portal/documents/download] Supabase error', error)
      return NextResponse.json({ error: { message: 'Could not generate download link' } }, { status: 500 })
    }

    return NextResponse.json({ url: data.signedUrl, filename: doc.title, mimeType: doc.mimeType })
  } catch (err) {
    return handleApiError(err, 'GET /api/portal/documents/[id]/download')
  }
}
