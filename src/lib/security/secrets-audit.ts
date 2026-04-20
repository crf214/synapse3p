// ---------------------------------------------------------------------------
// Secrets audit — verifies required env vars at startup
// ---------------------------------------------------------------------------

const PLACEHOLDER_SESSION_SECRET = 'changeme'

export interface SecretsAuditResult {
  passed:   boolean
  warnings: string[]
  errors:   string[]
}

export function auditSecrets(): SecretsAuditResult {
  const errors:   string[] = []
  const warnings: string[] = []
  const env = process.env

  // -------------------------------------------------------------------------
  // ERRORS — missing or clearly wrong, should block startup in production
  // -------------------------------------------------------------------------

  // SESSION_SECRET
  const sessionSecret = env.SESSION_SECRET
  if (!sessionSecret) {
    errors.push('SESSION_SECRET is missing')
  } else if (sessionSecret.length < 32) {
    errors.push(`SESSION_SECRET is too short (${sessionSecret.length} chars, minimum 32)`)
  }

  // DATABASE_URL
  const dbUrl = env.DATABASE_URL
  if (!dbUrl) {
    errors.push('DATABASE_URL is missing')
  } else if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL must start with postgresql:// or postgres://')
  }

  // DIRECT_URL
  const directUrl = env.DIRECT_URL
  if (!directUrl) {
    errors.push('DIRECT_URL is missing')
  } else if (!directUrl.startsWith('postgresql://') && !directUrl.startsWith('postgres://')) {
    errors.push('DIRECT_URL must start with postgresql:// or postgres://')
  }

  // NEXT_PUBLIC_SUPABASE_URL
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL is missing')
  } else if (!supabaseUrl.startsWith('https://')) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL must start with https://')
  }

  // NEXT_PUBLIC_SUPABASE_ANON_KEY
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) {
    errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing')
  } else if (anonKey.length < 20) {
    errors.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY is too short (${anonKey.length} chars, minimum 20)`)
  }

  // RESEND_API_KEY
  const resendKey = env.RESEND_API_KEY
  if (!resendKey) {
    errors.push('RESEND_API_KEY is missing')
  } else if (!resendKey.startsWith('re_')) {
    errors.push('RESEND_API_KEY must start with re_')
  }

  // -------------------------------------------------------------------------
  // WARNINGS — missing optional but important
  // -------------------------------------------------------------------------

  if (!env.NEWS_API_KEY) {
    warnings.push('NEWS_API_KEY is missing — external news signals will be disabled')
  }

  if (!env.NETSUITE_ACCOUNT_ID) {
    warnings.push('NETSUITE_ACCOUNT_ID is missing — ERP integration running in mock mode')
  }

  if (!env.ALERT_EMAIL) {
    warnings.push('ALERT_EMAIL is missing — failure alerts will not be sent')
  }

  const serviceKey = env.SUPABASE_SERVICE_KEY
  if (serviceKey) {
    const validFormat = serviceKey.startsWith('sb_secret_') || serviceKey.startsWith('eyJ')
    if (!validFormat) {
      warnings.push('SUPABASE_SERVICE_KEY is present but does not match expected format (sb_secret_... or eyJ...)')
    }
  }

  // -------------------------------------------------------------------------
  // SECURITY CHECKS — warn if suspicious
  // -------------------------------------------------------------------------

  if (sessionSecret && sessionSecret === PLACEHOLDER_SESSION_SECRET) {
    warnings.push('SESSION_SECRET appears to be the default placeholder value — change it before deploying')
  }

  const isProduction = env.NODE_ENV === 'production'

  if (isProduction) {
    if (dbUrl && dbUrl.includes('localhost')) {
      warnings.push('DATABASE_URL contains localhost — unexpected in production')
    }
    if (directUrl && directUrl.includes('localhost')) {
      warnings.push('DIRECT_URL contains localhost — unexpected in production')
    }
  }

  if (anonKey && serviceKey && anonKey === serviceKey) {
    warnings.push('NEXT_PUBLIC_SUPABASE_ANON_KEY equals SUPABASE_SERVICE_KEY — service role key may be exposed publicly')
  }

  return {
    passed:   errors.length === 0,
    warnings,
    errors,
  }
}

export function assertSecrets(): void {
  // During Next.js build phase, skip throwing — secrets are not available at build time
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    const { warnings, errors } = auditSecrets()
    if (errors.length > 0) {
      console.warn('[secrets-audit] Build-time secrets check — errors found (will throw at runtime):', errors)
    }
    warnings.forEach(w => console.warn(`[secrets-audit] WARN: ${w}`))
    return
  }

  const { passed, warnings, errors } = auditSecrets()

  for (const w of warnings) {
    console.warn(`[secrets-audit] WARN: ${w}`)
  }

  if (!passed) {
    const message = `Secrets audit failed:\n${errors.map(e => `  • ${e}`).join('\n')}`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message)
    } else {
      for (const e of errors) {
        console.warn(`[secrets-audit] ERROR: ${e}`)
      }
    }
  }
}
