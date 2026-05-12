'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api-client'

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''

  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [success,   setSuccess]   = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const res = await apiClient('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      })
      const json = await res.json() as { message?: string; error?: { message?: string } }
      if (!res.ok) {
        setError(json.error?.message ?? 'Something went wrong')
        return
      }
      setSuccess(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          This reset link is invalid or has expired.
        </p>
        <Link href="/auth/forgot-password" className="text-sm underline" style={{ color: 'var(--ink)' }}>
          Request a new reset link
        </Link>
      </div>
    )
  }

  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="px-4 py-4 rounded-xl text-sm" style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
          Password updated successfully.
        </div>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          <Link href="/auth/login" className="underline" style={{ color: 'var(--ink)' }}>
            Sign in with your new password
          </Link>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--red-soft)', color: 'var(--red-text)' }}>
          {error}
          {error.toLowerCase().includes('invalid or has expired') && (
            <span>
              {' '}
              <Link href="/auth/forgot-password" className="underline font-medium">
                Request a new link
              </Link>
            </span>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>New password</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border text-sm"
          style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
          placeholder="At least 8 characters"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>Confirm password</label>
        <input
          type="password"
          required
          minLength={8}
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border text-sm"
          style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
          placeholder="Re-enter your password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl text-sm font-medium transition-opacity"
        style={{ background: 'var(--ink)', color: '#fff', opacity: loading ? 0.6 : 1 }}
      >
        {loading ? 'Updating…' : 'Set new password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cream)' }}>
      <div className="w-full max-w-sm fade-up">
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl mb-2" style={{ color: 'var(--ink)' }}>Synapse3P</h1>
          <p style={{ color: 'var(--muted)', fontSize: 15 }}>Choose a new password</p>
        </div>
        <Suspense fallback={null}>
          <ResetPasswordInner />
        </Suspense>
      </div>
    </div>
  )
}
