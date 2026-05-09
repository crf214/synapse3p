'use client'
// src/app/auth/register/page.tsx
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { apiClient } from '@/lib/api-client'

export default function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialToken = searchParams.get('inviteToken') ?? ''

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteToken, setInviteToken] = useState(initialToken)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiClient('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, inviteToken }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (res.status === 403) {
          setError('This invitation is invalid or has expired.')
        } else {
          setError(json.error?.message ?? json.error ?? 'Registration failed')
        }
        return
      }
      router.push('/auth/verify-email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cream)' }}>
      <div className="w-full max-w-sm fade-up">
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl mb-2" style={{ color: 'var(--ink)' }}>Synapse3P</h1>
          <p style={{ color: 'var(--muted)', fontSize: 15 }}>Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--red-soft)', color: 'var(--red-text)' }}>
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>Your name</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border text-sm"
              style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
              placeholder="e.g. James"
            />
          </div>

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>Email</label>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border text-sm"
              style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>
              Password <span style={{ color: 'var(--muted)', fontWeight: 300 }}>(min. 8 characters)</span>
            </label>
            <input
              type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border text-sm"
              style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>Invitation code</label>
            {initialToken ? (
              <div
                className="w-full px-4 py-3 rounded-xl border text-sm font-mono truncate"
                style={{ border: '1px solid var(--border)', background: 'var(--cream)', color: 'var(--muted)', userSelect: 'none' }}
                title={inviteToken}
              >
                {inviteToken}
              </div>
            ) : (
              <input
                type="text" required value={inviteToken} onChange={e => setInviteToken(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border text-sm"
                style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
                placeholder="Paste your invitation code"
              />
            )}
          </div>

          <button
            type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-medium transition-opacity"
            style={{ background: 'var(--ink)', color: '#fff', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: 'var(--muted)' }}>
          Already have an account?{' '}
          <Link href="/auth/login" className="underline" style={{ color: 'var(--ink)' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
