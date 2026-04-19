# Synapse3P

Synapse3P is an enterprise-grade corporate operations platform designed to consolidate and automate the management of third-party relationships, business processes, and internal controls across the organisation.

Rather than relying on a collection of narrow, consultant-dependent tools, Synapse3P provides a single platform that grows with the business and integrates with existing systems — replacing point solutions with a configurable, auditable, and extensible foundation.

**Who it serves**
Management, risk, compliance, legal, technology, operations, and business line owners — not just finance. Every team that touches a third-party relationship, a business process, or a control objective has a role in the platform.

**What it manages**
- **Third-party lifecycle** — onboarding, due diligence, ongoing monitoring, risk scoring, and offboarding of vendors, service providers, brokers, counterparties, fund administrators, platforms, and other external relationships
- **Business process management** — configurable approval workflows, processing rules, and routing logic that adapt to how the organisation actually works, without code changes
- **Controls and compliance** — a built-in SOX/SOC2 control framework with automated testing, evidence collection, and audit period management — reducing reliance on manual spreadsheet-based compliance programmes
- **Financial operations** — purchase orders, invoice processing, bill pay, payment instruction management with four-eyes controls, and ERP integration

**How it integrates**
Synapse3P is designed to connect — not replace — the systems of record. It integrates with ERP systems (NetSuite), bank interfaces, e-signature providers (DocuSign, Adobe Sign), communication platforms (Microsoft Teams), and external data sources (news signals, stock prices, sanctions lists). It acts as the process and intelligence layer that sits above these systems, providing the workflow, audit trail, and risk context that individual integrations lack.

**What it automates**
Nightly health checks verify infrastructure integrity. Security controls are tested and logged daily. External signals (news, market data) are monitored for all active third parties. Report snapshots are pre-computed. FX rates are fetched and stored. Control tests run automatically and alert on failures — removing the need for manual monitoring routines and consultant-led reviews.

**The consolidation benefit**
Organisations typically manage third-party risk, contract lifecycle, AP workflow, compliance controls, and vendor onboarding across five or more separate tools — each with limited scope, poor integration, and dependency on external support for configuration changes. Synapse3P is designed to replace this fragmented landscape with a single configurable platform that internal teams can own and evolve.

**Stack:** Next.js 14 · PostgreSQL (Supabase) · Prisma · iron-session · Tailwind CSS · TypeScript

---

## Features

- **Entity management** — create, classify, and track third-party entities (vendors, clients, subsidiaries)
- **7-step onboarding workflow** — role-gated approval process covering legal review, cybersecurity, data privacy, bank setup, NetSuite linking, and CFO sign-off
- **NetSuite reconciliation** — match Synapse3P entities to ERP vendor records; surface unmatched entities on both sides
- **Document attachments** — upload compliance docs (PDF, DOC, DOCX, PNG, JPEG) against onboarding steps via Supabase Storage
- **SOX/SOC2 controls framework** — 20 controls with automated testing and audit period tracking
- **Role-based access** — 10 roles with per-route and per-action enforcement
- **Stock price history** — 18-month backfill with daily price tracking per entity
- **Activity logs** — immutable audit trail on every entity

---

## Roles

| Role | Description |
|------|-------------|
| `ADMIN` | Full access |
| `CFO` | Financial oversight, final onboarding approval |
| `CONTROLLER` | Financial controls and reporting |
| `FINANCE_MANAGER` | Day-to-day entity and payment management |
| `AP_CLERK` | Accounts payable operations |
| `LEGAL` | Legal & compliance review (onboarding Step 2) |
| `CISO` | Cybersecurity assessment (onboarding Step 3) |
| `AUDITOR` | Read-only access to controls and audit periods |
| `VENDOR` | Vendor self-service portal |
| `CLIENT` | Client portal |

---

## Getting started

### 1. Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. From **Settings → API**: copy your API URL and anon key
3. From **Settings → Database → Connection string**:
   - **Transaction** pooler URL (port 6543) → `DATABASE_URL`
   - **Direct** connection URL (port 5432) → `DIRECT_URL`
4. From **Settings → API**: copy the service role key → `SUPABASE_SERVICE_KEY`
5. In **Storage → New bucket**: create `synapse3p-files` (private)
   - Also create `contracts` bucket (private) for onboarding document attachments

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://postgres.your-project:PASSWORD@aws-x-us-east-x.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.your-project:PASSWORD@aws-x-us-east-x.pooler.supabase.com:5432/postgres
SESSION_SECRET=<run: openssl rand -hex 32>
SUPABASE_SERVICE_KEY=your_service_key_here
SUPABASE_STORAGE_BUCKET=synapse3p-files
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...         # For onboarding step email notifications
ERP_ADAPTER=mock              # mock | netsuite
```

### 3. Install and run

```bash
npm install
npm run db:migrate    # Apply all migrations
npm run db:seed       # Seed demo data and default roles
npm run dev           # Starts at http://localhost:3001
```

---

## Project structure

```
src/
  app/
    api/
      auth/                   Login, register, logout, me
      entities/               Entity CRUD, bank accounts, onboarding,
                              netsuite-match, reconciliation
      controls/               SOX/SOC2 controls and test runs
      audit-periods/          Audit period management
      erp/                    ERP adapter endpoints
      reports/                Reporting endpoints
      user/                   User profile
    dashboard/
      page.tsx                Overview dashboard
      entities/               Entity list, detail, onboarding, reconciliation
      controls/               Controls framework
      audit-periods/          Audit periods
      reports/                Reports
    auth/
      login/
      register/
    portal/                   Vendor/client self-service portal
  components/
    shared/                   Sidebar, layout primitives
  lib/
    prisma.ts                 DB client
    session.ts                iron-session auth
    supabase.ts               Supabase storage client
    erp/                      ERP adapter (mock + NetSuite)
    fx/                       FX rate utilities
    stocks/                   Stock price utilities
    controls/                 Control testing logic
    security/                 Input sanitisation, outbound fetch guard
    errors.ts                 AppError hierarchy + handleApiError
prisma/
  schema.prisma               Full database schema
  migrations/                 Migration history
  seed.ts                     Demo seed data
```

---

## Commands

```bash
npm run dev           # Run locally (port 3001)
npm run build         # Production build
npm run db:migrate    # Create and apply a migration
npm run db:push       # Sync schema without migration (dev only)
npm run db:seed       # Seed demo data
npm run db:studio     # Open Prisma Studio
npm run test          # Run tests (Vitest)
npm run test:watch    # Watch mode
npm run lint          # ESLint
```

---

## Deployment (Vercel)

```bash
npm i -g vercel
vercel
```

Add all `.env.local` variables to the Vercel project environment, then update `NEXT_PUBLIC_APP_URL` to your live domain.

---

## Troubleshooting

**Session errors** — `SESSION_SECRET` must be identical across all deployments. Generate once with `openssl rand -hex 32` and never rotate it while users are logged in.

**Storage upload failures** — confirm both Supabase buckets (`synapse3p-files`, `contracts`) exist and that `SUPABASE_SERVICE_KEY` is the service role key, not the anon key.

**Prisma type errors** — run `npm run postinstall` (or `npx prisma generate`) after any schema change.

**`LEGAL`/`CISO` role errors** — ensure migration `20260419002442_add_legal_ciso_roles` has been applied (`npm run db:migrate`).
