// Thin fetch wrapper that automatically attaches the CSRF token header on all
// state-mutating requests and handles expired sessions gracefully.
// Import and use instead of raw fetch() in client components.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function getCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ''
}

// Singleton so we only show one banner + trigger one redirect per expiry event.
let sessionExpiredHandled = false

function handleSessionExpired(): void {
  if (sessionExpiredHandled) return
  sessionExpiredHandled = true

  // Insert a fixed banner at the top of the page.
  if (typeof document !== 'undefined') {
    const banner = document.createElement('div')
    banner.setAttribute('role', 'alert')
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:#1C1917', 'color:#fff', 'font-size:14px',
      'font-family:system-ui,sans-serif', 'padding:14px 24px',
      'text-align:center', 'box-shadow:0 2px 8px rgba(0,0,0,.25)',
    ].join(';')
    banner.textContent = 'Your session has expired. Redirecting to login…'
    document.body.prepend(banner)
  }

  setTimeout(() => {
    window.location.href = '/auth/login?reason=session_expired'
  }, 2000)
}

export async function apiClient(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers as HeadersInit | undefined)

  if (MUTATING.has(method)) {
    const csrf = getCsrfToken()
    if (csrf) headers.set('x-csrf-token', csrf)

    // Don't override Content-Type if the body is FormData (browser sets boundary)
    if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }

  const res = await fetch(url, { ...init, headers })

  if (res.status === 401) {
    handleSessionExpired()
    // Return the response so callers don't crash trying to read it,
    // but the redirect will fire before they can act on it.
  }

  return res
}
