import { getIronSession } from 'iron-session'
import { NextRequest, NextResponse } from 'next/server'
import type { SessionData } from '@/lib/session'
import { sessionOptions as SESSION_OPTIONS } from '@/lib/session-config'

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_ROUTES.has(pathname) && !isProtected(pathname)) {
    const res = NextResponse.next()

    if (isAuthPage(pathname)) {
      const session = await getIronSession<SessionData>(req, res, SESSION_OPTIONS)
      if (session.userId) {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
    }

    return res
  }

  if (isProtected(pathname)) {
    const res = NextResponse.next()
    const session = await getIronSession<SessionData>(req, res, SESSION_OPTIONS)

    if (!session.userId) {
      const loginUrl = new URL('/auth/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
