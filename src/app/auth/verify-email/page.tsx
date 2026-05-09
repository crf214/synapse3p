'use client'
// src/app/auth/verify-email/page.tsx
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function VerifyEmailPage() {
  const searchParams = useSearchParams()
  const verified = searchParams.get('verified') === 'true'

  if (verified) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cream)' }}>
        <div className="w-full max-w-sm fade-up text-center">
          <h1 className="font-display text-4xl mb-2" style={{ color: 'var(--ink)' }}>Synapse3P</h1>
          <div
            className="mt-8 px-6 py-8 rounded-2xl"
            style={{ background: '#fff', border: '1px solid var(--border)' }}
          >
            <div className="text-3xl mb-4">✓</div>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Email verified!</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
              Your email address has been confirmed. You can now sign in to your account.
            </p>
            <Link
              href="/auth/login"
              className="inline-block w-full py-3 rounded-xl text-sm font-medium text-center"
              style={{ background: 'var(--ink)', color: '#fff' }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--cream)' }}>
      <div className="w-full max-w-sm fade-up text-center">
        <h1 className="font-display text-4xl mb-2" style={{ color: 'var(--ink)' }}>Synapse3P</h1>
        <div
          className="mt-8 px-6 py-8 rounded-2xl"
          style={{ background: '#fff', border: '1px solid var(--border)' }}
        >
          <div className="text-3xl mb-4">✉</div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--ink)' }}>Check your inbox</h2>
          <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
            We sent a verification link to your email address.
          </p>
          <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
            The link expires in 24 hours. If you don&apos;t see it, check your spam folder.
          </p>
          <Link
            href="/auth/login"
            className="text-sm underline"
            style={{ color: 'var(--ink)' }}
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
