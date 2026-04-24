# Known vulnerabilities

**Total:** 13 (9 moderate, 4 high) — Last reviewed: 2026-04-23

## Next.js / eslint-config-next — high severity (tracked, not yet resolved)

**Affected version:** next@14.2.35, eslint-config-next@14.2.35
**Fix requires:** Next.js 15+ (breaking change upgrade) — tracked in GitHub Issue #4
**Scheduled for:** Dedicated upgrade sprint
**Risk assessment:** DoS vulnerabilities only — no data exfiltration or auth bypass risk
**Mitigations in place:** Rate limiting on all API routes, Vercel DDoS protection

CVEs:
- GHSA-9g9p-9gw9-jx7f — DoS via Image Optimizer remotePatterns
- GHSA-h25m-26qc-wcjf — DoS via insecure React Server Components
- GHSA-ggv3-7p47-pfv8 — HTTP request smuggling in rewrites
- GHSA-3x4c-7xq6-9pq8 — Unbounded next/image disk cache growth
- GHSA-q4gf-8mx6-v5v3 — DoS with Server Components
- GHSA-5j98-mcp5-4vw2 — glob high severity via @next/eslint-plugin-next (fix bundled with Next.js 15)

## resend — moderate severity (blocked on breaking change)

**Affected package:** svix (transitive dependency of resend@6.12.2)
**GHSA:** GHSA-w5hq-g745-h8pq — uuid moderate
**Fix requires:** resend@6.1.3+ (breaking API change)
**Risk assessment:** svix is used only for inbound webhook signature verification; no production data at risk from this advisory
**Mitigations in place:** Webhook endpoint validates the shared-secret header before any payload processing

## esbuild — moderate severity (dev only)

**Affected package:** esbuild (transitive dependency of vite, used by vitest)
**GHSA:** GHSA-67mh-4wv8-2f99 — esbuild moderate
**Fix requires:** vitest@4.1.5+ (breaking change)
**Risk assessment:** Development dependency only — not present in production build or runtime. Zero production risk.
**Mitigations in place:** N/A (dev tooling only)
