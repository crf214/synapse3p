import { ForbiddenError } from '@/lib/errors'

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

const ALLOWED_DOMAINS = new Set([
  'api.frankfurter.app',
  'newsapi.org',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'api.resend.com',
])

export function addAllowedDomain(domain: string): void {
  ALLOWED_DOMAINS.add(domain)
}

// Dynamic additions at module load time
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (supabaseUrl) {
  try { addAllowedDomain(new URL(supabaseUrl).hostname) } catch {}
}

const netsuiteAccountId = process.env.NETSUITE_ACCOUNT_ID
if (netsuiteAccountId) {
  addAllowedDomain(`${netsuiteAccountId}.suitetalk.api.netsuite.com`)
}

// ---------------------------------------------------------------------------
// Private IP detection
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

export function isPrivateIp(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true

  // Parse dotted-decimal IPv4
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map(Number)
  if (octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return false

  const [a, b] = octets

  return (
    a === 10 ||                           // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||           // 192.168.0.0/16
    (a === 169 && b === 254)              // 169.254.0.0/16 link-local
  )
}

// ---------------------------------------------------------------------------
// safeExternalFetch
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000

export async function safeExternalFetch(
  url:      string,
  options?: RequestInit,
  context?: string,
): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ForbiddenError(`Invalid URL: ${url}`)
  }

  const { hostname, protocol, pathname } = parsed

  if (isPrivateIp(hostname)) {
    throw new ForbiddenError('Outbound request to private network blocked')
  }

  if (protocol !== 'https:') {
    throw new ForbiddenError('Outbound request must use HTTPS')
  }

  if (!ALLOWED_DOMAINS.has(hostname)) {
    throw new ForbiddenError(`Outbound request to ${hostname} is not permitted`)
  }

  // Log pathname only — never log query params (avoids API key leakage in logs)
  console.info({
    event:   'outbound_request',
    host:    hostname,
    path:    pathname,
    context: context ?? null,
    ts:      new Date().toISOString(),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request to ${hostname} timeout after ${TIMEOUT_MS}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
