import { NextResponse } from 'next/server'
import { generateCsrfToken } from '@/lib/csrf'

export async function GET(): Promise<NextResponse> {
  const token = generateCsrfToken()
  const secure = process.env.NODE_ENV === 'production'

  const res = NextResponse.json({ csrfToken: token })
  res.cookies.set('csrf_token', token, {
    httpOnly: false,   // must be JS-readable for double-submit pattern
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours — refresh on next layout mount
  })
  return res
}
