'use client'
import { useEffect } from 'react'

// Fetches a fresh CSRF token from the server on every page load and stores it
// as the csrf_token cookie. The apiClient reads this cookie automatically.
export function CsrfInitializer() {
  useEffect(() => {
    fetch('/api/auth/csrf').catch(() => {
      // Non-fatal — the user will get a 403 on their first mutating request
      // and can refresh to retry.
    })
  }, [])
  return null
}
