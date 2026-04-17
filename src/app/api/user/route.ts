// src/app/api/user/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, getSession } from '@/lib/session'
import { uploadAvatar } from '@/lib/supabase'
import { z } from 'zod'

const PatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()
    const data = PatchSchema.parse(body)

    const user = await prisma.user.update({ where: { id: userId }, data })

    // Update session name if changed
    if (data.name !== undefined) {
      const session = await getSession()
      session.name = user.name
      await session.save()
    }

    return NextResponse.json({ data: { name: user.name, avatar: user.avatar } })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const formData = await req.formData()
    const file = formData.get('avatar') as File | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const url = await uploadAvatar(file, userId)
    const user = await prisma.user.update({ where: { id: userId }, data: { avatar: url } })

    return NextResponse.json({ data: { avatar: user.avatar } })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
