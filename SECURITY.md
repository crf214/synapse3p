# Security

## Reporting vulnerabilities

Please report security vulnerabilities by emailing the address in `ALERT_EMAIL`.
Do not open public GitHub issues for security vulnerabilities.

## Security controls in place

- Outbound request allowlisting (`src/lib/security/outbound.ts`)
- API response sanitisation (`src/lib/security/sanitise.ts`)
- Secrets audit at startup (`src/lib/security/secrets-audit.ts`)
- Row Level Security on all database tables
- Rate limiting on all API routes
- Four-eyes controls on payment instructions
- Nightly security health checks

## Dependency policy

- All dependencies pinned to exact versions (`.npmrc`)
- Weekly automated dependency audit (GitHub Actions)
- `npm audit` runs on every CI build
