// Web Crypto API — available in both Edge Runtime and Node.js (no import needed).
import type { NextRequest } from 'next/server'

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function validateCsrfToken(request: NextRequest): boolean {
  const headerToken = request.headers.get('x-csrf-token')
  const cookieToken = request.cookies.get('csrf_token')?.value
  return !!(headerToken && cookieToken && headerToken === cookieToken)
}
