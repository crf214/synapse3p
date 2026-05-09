export function getSecurityHeaders(): Record<string, string> {
  const isDev = process.env.NODE_ENV !== 'production'

  const csp = [
    "default-src 'self'",

    // KNOWN LIMITATION: 'unsafe-inline' is required for Next.js inline scripts
    // (hydration bootstrapping). Nonce-based CSP would remove this but requires
    // custom server setup incompatible with Vercel's edge runtime.
    isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"  // unsafe-eval: React Fast Refresh (dev only)
      : "script-src 'self' 'unsafe-inline'",

    // KNOWN LIMITATION: 'unsafe-inline' is required for Tailwind CSS-in-JS and
    // Next.js style injection. Also allows googleapis.com for the DM font import.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

    // fonts.gstatic.com serves the actual font files for Google Fonts
    "font-src 'self' https://fonts.gstatic.com",

    // blob: for file previews; data: for inline images
    "img-src 'self' data: blob: https:",

    // API and storage endpoints the browser connects to directly
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://api.resend.com https://newsapi.org",

    // Supabase Storage previews rendered in iframes
    "frame-src 'self' blob: https://*.supabase.co",

    // Prevents this page from being embedded in any frame (clickjacking)
    "frame-ancestors 'none'",

    // Restricts where forms can submit to
    "form-action 'self'",

    // Prevents base-tag injection attacks
    "base-uri 'self'",
  ].join('; ')

  const headers: Record<string, string> = {
    'Content-Security-Policy':   csp,
    'X-Frame-Options':           'DENY',
    'X-Content-Type-Options':    'nosniff',
    'Referrer-Policy':           'strict-origin-when-cross-origin',
    'Permissions-Policy':        'camera=(), microphone=(), geolocation=()',
  }

  if (!isDev) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  }

  return headers
}

