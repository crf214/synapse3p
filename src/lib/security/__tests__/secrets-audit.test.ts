import { describe, it, expect, beforeEach, vi } from 'vitest'
import { auditSecrets } from '../secrets-audit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ENV: Record<string, string> = {
  SESSION_SECRET:               'a'.repeat(32),
  DATABASE_URL:                 'postgresql://user:pass@host:5432/db',
  DIRECT_URL:                   'postgresql://user:pass@host:5432/db',
  NEXT_PUBLIC_SUPABASE_URL:     'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc',
  RESEND_API_KEY:               're_test_key',
  NODE_ENV:                     'development',
}

function withEnv(overrides: Record<string, string | undefined>) {
  // vi.stubEnv only accepts string values; we handle removal via undefined
  const merged = { ...VALID_ENV, ...overrides }
  for (const [, v] of Object.entries(merged)) {
    if (v === undefined) {
      vi.unstubAllEnvs() // reset first, then re-stub without the key
      break
    }
  }
  // Stub each key individually
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) {
      vi.stubEnv(k, v)
    } else {
      vi.stubEnv(k, '')   // stub as empty string to simulate missing
    }
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// All required secrets present
// ---------------------------------------------------------------------------

describe('auditSecrets — valid configuration', () => {
  it('returns passed: true with no errors when all required secrets are present', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    const result = auditSecrets()
    expect(result.passed).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// SESSION_SECRET errors
// ---------------------------------------------------------------------------

describe('auditSecrets — SESSION_SECRET', () => {
  it('errors when SESSION_SECRET is missing (empty string)', () => {
    withEnv({ SESSION_SECRET: '' })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('SESSION_SECRET'))).toBe(true)
  })

  it('errors when SESSION_SECRET is shorter than 32 characters', () => {
    withEnv({ SESSION_SECRET: 'tooshort' })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('SESSION_SECRET') && e.includes('short'))).toBe(true)
  })

  it('accepts SESSION_SECRET of exactly 32 characters', () => {
    withEnv({ SESSION_SECRET: 'x'.repeat(32) })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('SESSION_SECRET'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DATABASE_URL errors
// ---------------------------------------------------------------------------

describe('auditSecrets — DATABASE_URL', () => {
  it('errors when DATABASE_URL is missing', () => {
    withEnv({ DATABASE_URL: '' })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('DATABASE_URL'))).toBe(true)
  })

  it('errors when DATABASE_URL has wrong protocol', () => {
    withEnv({ DATABASE_URL: 'mysql://user:pass@host/db' })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('DATABASE_URL') && e.includes('postgresql://'))).toBe(true)
  })

  it('accepts postgres:// prefix as valid', () => {
    withEnv({ DATABASE_URL: 'postgres://user:pass@host:5432/db' })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('DATABASE_URL'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RESEND_API_KEY errors
// ---------------------------------------------------------------------------

describe('auditSecrets — RESEND_API_KEY', () => {
  it('errors when RESEND_API_KEY is missing', () => {
    withEnv({ RESEND_API_KEY: '' })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('RESEND_API_KEY'))).toBe(true)
  })

  it('errors when RESEND_API_KEY does not start with re_', () => {
    withEnv({ RESEND_API_KEY: 'sk_live_12345' })
    const { errors } = auditSecrets()
    expect(errors.some(e => e.includes('RESEND_API_KEY') && e.includes('re_'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Optional secret warnings (not errors)
// ---------------------------------------------------------------------------

describe('auditSecrets — optional secrets produce warnings not errors', () => {
  it('warns (not errors) when NEWS_API_KEY is missing', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('NEWS_API_KEY', '')
    const { errors, warnings, passed } = auditSecrets()
    expect(errors.some(e => e.includes('NEWS_API_KEY'))).toBe(false)
    expect(warnings.some(w => w.includes('NEWS_API_KEY'))).toBe(true)
    expect(passed).toBe(true)
  })

  it('warns (not errors) when NETSUITE_ACCOUNT_ID is missing', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('NETSUITE_ACCOUNT_ID', '')
    const { errors, warnings } = auditSecrets()
    expect(errors.some(e => e.includes('NETSUITE_ACCOUNT_ID'))).toBe(false)
    expect(warnings.some(w => w.includes('NETSUITE_ACCOUNT_ID'))).toBe(true)
  })

  it('warns (not errors) when ALERT_EMAIL is missing', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('ALERT_EMAIL', '')
    const { errors, warnings } = auditSecrets()
    expect(errors.some(e => e.includes('ALERT_EMAIL'))).toBe(false)
    expect(warnings.some(w => w.includes('ALERT_EMAIL'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Security checks — suspicious configuration warnings
// ---------------------------------------------------------------------------

describe('auditSecrets — security checks', () => {
  it('warns when DATABASE_URL contains localhost in production', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('NODE_ENV',      'production')
    vi.stubEnv('DATABASE_URL',  'postgresql://user:pass@localhost:5432/db')
    vi.stubEnv('DIRECT_URL',    'postgresql://user:pass@host:5432/db')
    const { warnings } = auditSecrets()
    expect(warnings.some(w => w.includes('DATABASE_URL') && w.includes('localhost'))).toBe(true)
  })

  it('does NOT warn about localhost in DATABASE_URL in development', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('NODE_ENV',     'development')
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db')
    const { warnings } = auditSecrets()
    expect(warnings.some(w => w.includes('DATABASE_URL') && w.includes('localhost'))).toBe(false)
  })

  it('warns when NEXT_PUBLIC_SUPABASE_ANON_KEY equals SUPABASE_SERVICE_KEY', () => {
    const sharedKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.shared_key_value'
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', sharedKey)
    vi.stubEnv('SUPABASE_SERVICE_KEY',          sharedKey)
    const { warnings } = auditSecrets()
    expect(warnings.some(w => w.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY') && w.includes('SUPABASE_SERVICE_KEY'))).toBe(true)
  })

  it('does not warn when anon key and service key are different', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon')
    vi.stubEnv('SUPABASE_SERVICE_KEY',          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service')
    const { warnings } = auditSecrets()
    const keyMismatchWarning = warnings.some(
      w => w.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY') && w.includes('SUPABASE_SERVICE_KEY')
    )
    expect(keyMismatchWarning).toBe(false)
  })

  it('warns about SUPABASE_SERVICE_KEY with unexpected format when present', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'plaintext_bad_key')
    const { warnings } = auditSecrets()
    expect(warnings.some(w => w.includes('SUPABASE_SERVICE_KEY') && w.includes('format'))).toBe(true)
  })

  it('accepts SUPABASE_SERVICE_KEY starting with eyJ (JWT)', () => {
    for (const [k, v] of Object.entries(VALID_ENV)) vi.stubEnv(k, v)
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.valid')
    const { warnings } = auditSecrets()
    expect(warnings.some(w => w.includes('SUPABASE_SERVICE_KEY') && w.includes('format'))).toBe(false)
  })
})
