import { getIronSession } from 'iron-session'
import { NextRequest, NextResponse } from 'next/server'
import type { SessionData } from '@/lib/session'
import { sessionOptions as SESSION_OPTIONS } from '@/lib/session-config'
import { getSecurityHeaders } from '@/lib/security/headers'
import { authLimiter, apiLimiter } from '@/lib/security/rateLimit'
import { validateCsrfToken } from '@/lib/csrf'

const PUBLIC_ROUTES = new Set([
  '/',
  '/auth/login',
  '/auth/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/health',
])

function isProtected(pathname: string) {
  return pathname.startsWith('/dashboard') || pathname.startsWith('/portal')
}

function isAuthPage(pathname: string) {
  return pathname === '/auth/login' || pathname === '/auth/register'
}

function isAuthApiRoute(pathname: string) {
  return pathname.startsWith('/api/auth/')
}

function isApiRoute(pathname: string) {
  return pathname.startsWith('/api/')
}

const CSRF_MUTATING   = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_EXCLUDED   = new Set(['/api/auth/csrf', '/api/health'])
const CSRF_EXCL_PREFIX = ['/api/webhooks/']

function needsCsrf(pathname: string, method: string): boolean {
  if (!CSRF_MUTATING.has(method)) return false
  if (!isApiRoute(pathname))       return false
  if (CSRF_EXCLUDED.has(pathname)) return false
  if (CSRF_EXCL_PREFIX.some(p => pathname.startsWith(p))) return false
  return true
}

/** IP or forwarded-for header used as rate-limit identifier. */
function getIdentifier(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

function applySecurityHeaders(res: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(getSecurityHeaders())) {
    res.headers.set(key, value)
  }
  return res
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const identifier = getIdentifier(req)

  // ---------------------------------------------------------------------------
  // CSRF validation — must run before rate limiting and session work
  // ---------------------------------------------------------------------------
  if (needsCsrf(pathname, req.method)) {
    if (!validateCsrfToken(req)) {
      return applySecurityHeaders(
        NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 }),
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Rate limiting — applied before any session work
  // ---------------------------------------------------------------------------
  if (isAuthApiRoute(pathname)) {
    const { allowed, remaining, resetAt } = authLimiter.check(identifier)
    if (!allowed) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
          {
            status: 429,
            headers: {
              'Retry-After':          String(Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
              'X-RateLimit-Remaining': '0',
            },
          },
        ),
      )
    }
    // Attach remaining count for API consumers
    req.headers.set('X-RateLimit-Remaining', String(remaining))
  } else if (isApiRoute(pathname)) {
    const { allowed, remaining, resetAt } = apiLimiter.check(identifier)
    if (!allowed) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
          {
            status: 429,
            headers: {
              'Retry-After':           String(Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
              'X-RateLimit-Remaining': '0',
            },
          },
        ),
      )
    }
    req.headers.set('X-RateLimit-Remaining', String(remaining))
  }

  // ---------------------------------------------------------------------------
  // Session and route protection (unchanged logic)
  // ---------------------------------------------------------------------------
  if (PUBLIC_ROUTES.has(pathname) && !isProtected(pathname)) {
    const res = NextResponse.next()

    if (isAuthPage(pathname)) {
      const session = await getIronSession<SessionData>(req, res, SESSION_OPTIONS)
      if (session.userId) {
        return applySecurityHeaders(NextResponse.redirect(new URL('/dashboard', req.url)))
      }
    }

    return applySecurityHeaders(res)
  }

  if (isProtected(pathname)) {
    const res = NextResponse.next()
    const session = await getIronSession<SessionData>(req, res, SESSION_OPTIONS)

    if (!session.userId) {
      const loginUrl = new URL('/auth/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      // Only add session_expired if a cookie was present but invalid/expired.
      // If there is no session cookie at all this is a fresh visit, not expiry.
      const hasSessionCookie = req.cookies.has('synapse3p_session')
      if (hasSessionCookie) loginUrl.searchParams.set('reason', 'session_expired')
      return applySecurityHeaders(NextResponse.redirect(loginUrl))
    }

    return applySecurityHeaders(res)
  }

  return applySecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
