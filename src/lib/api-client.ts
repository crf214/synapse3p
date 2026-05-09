// Thin fetch wrapper that automatically attaches the CSRF token header on all
// state-mutating requests. Import and use instead of raw fetch() in client
// components for any POST / PUT / PATCH / DELETE call.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function getCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ''
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

  return fetch(url, { ...init, headers })
}
