'use client'

import { useState } from 'react'
import Link from 'next/link'
import { apiClient } from '@/lib/api-client'

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiClient('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: { message?: string } }
        setError(json.error?.message ?? 'Something went wrong')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cream)' }}>
      <div className="w-full max-w-sm fade-up">
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl mb-2" style={{ color: 'var(--ink)' }}>Synapse3P</h1>
          <p style={{ color: 'var(--muted)', fontSize: 15 }}>Reset your password</p>
        </div>

        {submitted ? (
          <div className="text-center space-y-4">
            <div className="px-4 py-4 rounded-xl text-sm" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
              Check your inbox for a reset link. It expires in 1 hour.
            </div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              <Link href="/auth/login" className="underline" style={{ color: 'var(--ink)' }}>
                Back to login
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--red-soft)', color: 'var(--red-text)' }}>
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border text-sm"
                style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
                placeholder="you@example.com"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-medium transition-opacity"
              style={{ background: 'var(--ink)', color: '#fff', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <p className="text-center text-sm" style={{ color: 'var(--muted)' }}>
              <Link href="/auth/login" className="underline" style={{ color: 'var(--ink)' }}>
                Back to login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
