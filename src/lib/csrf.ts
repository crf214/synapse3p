import { randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex')
}

export function validateCsrfToken(request: NextRequest): boolean {
  const headerToken = request.headers.get('x-csrf-token')
  const cookieToken = request.cookies.get('csrf_token')?.value
  return !!(headerToken && cookieToken && headerToken === cookieToken)
}
