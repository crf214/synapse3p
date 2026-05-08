export function getSecurityHeaders(): Record<string, string> {
  const isDev = process.env.NODE_ENV !== 'production'
  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      "default-src 'self'",
      // unsafe-eval is required by Next.js React Fast Refresh in development only
      isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.resend.com https://newsapi.org",
      "frame-src 'self' blob: https://*.supabase.co",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Frame-Options':           'DENY',
    'X-Content-Type-Options':    'nosniff',
    'Referrer-Policy':           'strict-origin-when-cross-origin',
    'Permissions-Policy':        'camera=(), microphone=(), geolocation=()',
  }

  if (process.env.NODE_ENV === 'production') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  }

  return headers
}
