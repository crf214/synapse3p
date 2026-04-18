# Known vulnerabilities

## Next.js high severity (tracked, not yet resolved)

**Affected version:** 14.2.35
**Fix requires:** Next.js 15+ (breaking change upgrade)
**Scheduled for:** Dedicated upgrade sprint
**Risk assessment:** DoS vulnerabilities only — no data exfiltration or auth bypass risk
**Mitigations in place:** Rate limiting on all API routes, Vercel DDoS protection

CVEs:
- GHSA-9g9p-9gw9-jx7f — DoS via Image Optimizer remotePatterns
- GHSA-h25m-26qc-wcjf — DoS via insecure React Server Components
- GHSA-ggv3-7p47-pfv8 — HTTP request smuggling in rewrites
- GHSA-3x4c-7xq6-9pq8 — Unbounded next/image disk cache growth
- GHSA-q4gf-8mx6-v5v3 — DoS with Server Components

Last reviewed: 2026-04-18
