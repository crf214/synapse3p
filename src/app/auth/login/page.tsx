'use client'
// src/app/auth/login/page.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error?.message ?? json.error ?? 'Login failed'); return }
      router.push('/dashboard')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cream)' }}>
      <div className="w-full max-w-sm fade-up">
        <div className="text-center mb-10">
          <h1 className="font-display text-4xl mb-2" style={{ color: 'var(--ink)' }}>Synapse3P</h1>
          <p style={{ color: 'var(--muted)', fontSize: 15 }}>Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--red-soft)', color: 'var(--red-text)' }}>
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>Email</label>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border text-sm transition-colors"
              style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--muted)' }}>Password</label>
            <input
              type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border text-sm"
              style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)' }}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-medium transition-opacity"
            style={{ background: 'var(--ink)', color: '#fff', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: 'var(--muted)' }}>
          No account?{' '}
          <Link href="/auth/register" className="underline" style={{ color: 'var(--ink)' }}>
            Register
          </Link>
        </p>
      </div>
    </div>
  )
}
