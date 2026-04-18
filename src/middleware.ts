import { getIronSession } from 'iron-session'
import { NextRequest, NextResponse } from 'next/server'
import type { SessionData } from '@/lib/session'
import { sessionOptions as SESSION_OPTIONS } from '@/lib/session-config'
import { getSecurityHeaders } from '@/lib/security/headers'
import { authLimiter, apiLimiter } from '@/lib/security/rateLimit'

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
