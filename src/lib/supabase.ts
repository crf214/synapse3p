// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'property-photos'

export async function uploadPhoto(
  file: File,
  userId: string,
  propertyId: string
): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${userId}/${propertyId}/${Date.now()}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: false, contentType: file.type })

  if (error) throw new Error(`Upload failed: ${error.message}`)

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function deletePhoto(url: string): Promise<void> {
  const parts = url.split(`/storage/v1/object/public/${BUCKET}/`)
  if (parts.length < 2) return
  const path = parts[1]
  await supabaseAdmin.storage.from(BUCKET).remove([path])
}

export async function uploadAvatar(file: File, userId: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${userId}/avatar.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { upsert: true, contentType: file.type })

  if (error) throw new Error(`Upload failed: ${error.message}`)

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  // Bust cache with timestamp
  return `${data.publicUrl}?t=${Date.now()}`
}

const DOC_BUCKET = 'property-documents'

export async function uploadDocument(
  file: File,
  userId: string,
  propertyId: string
): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${userId}/${propertyId}/${Date.now()}-${safeName}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const { error } = await supabaseAdmin.storage
    .from(DOC_BUCKET)
    .upload(path, buffer, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (error) throw new Error(`Upload failed: ${error.message}`)

  const { data } = supabaseAdmin.storage.from(DOC_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function deleteDocument(url: string): Promise<void> {
  const parts = url.split(`/storage/v1/object/public/${DOC_BUCKET}/`)
  if (parts.length < 2) return
  const path = parts[1]
  await supabaseAdmin.storage.from(DOC_BUCKET).remove([path])
}