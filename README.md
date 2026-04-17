# HomeDecide — Setup & Deployment Guide

## Overview

Full-stack Next.js app for you and your wife to evaluate UK properties.  
Stack: **Next.js 14 · PostgreSQL (Supabase) · Prisma · iron-session · Tailwind CSS**

---

## Step 1 — Create a Supabase project (10 min)

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New project**, choose a name (e.g. `homedecide`) and a strong DB password
3. Choose region: **Europe West (London)** — closest to you
4. Wait ~2 minutes for the project to provision

### Get your credentials

From the Supabase dashboard:

- **API URL + Anon key**: Settings → API
- **Database URLs**: Settings → Database → Connection string
  - Copy the **Transaction** pooler URL → this is your `DATABASE_URL`
  - Copy the **Direct** connection URL → this is your `DIRECT_URL`

### Create the storage bucket

In Supabase: Storage → New bucket  
- Name: `property-photos`  
- Public: **Yes** (so photos load without auth tokens)

---

## Step 2 — Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
DATABASE_URL=postgresql://postgres.YOUR_PROJECT_ID:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.YOUR_PROJECT_ID:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
SESSION_SECRET=<run: openssl rand -hex 32>
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_STORAGE_BUCKET=property-photos
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate a session secret:
```bash
openssl rand -hex 32
```

---

## Step 3 — Install and run locally

```bash
npm install
npm run db:push       # Creates all tables in Supabase
npm run dev           # Starts at http://localhost:3000
```

Open http://localhost:3000 — you'll be redirected to `/auth/register`.

**Register yourself first, then your wife registers separately.**  
Each account gets their own independent set of ratings and criteria.

---

## Step 4 — Deploy to Vercel (5 min)

### Option A — Vercel CLI (fastest)

```bash
npm i -g vercel
vercel                # Follow prompts, link to your GitHub or deploy directly
```

### Option B — GitHub + Vercel dashboard

1. Push this project to a GitHub repo:
   ```bash
   git init && git add . && git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/homedecide
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Add all environment variables from `.env.local` (except `NEXT_PUBLIC_APP_URL` — set that to your Vercel URL)
4. Deploy

### After deployment

Update `NEXT_PUBLIC_APP_URL` in Vercel to your live URL (e.g. `https://homedecide.vercel.app`)

---

## Step 5 — Share a property with your wife

1. You both register with your own email addresses
2. On any property page, scroll to **Share this property**
3. Enter your wife's email address → she can now view and rate it independently
4. Her ratings are completely separate from yours — you each see your own scores

---

## Project structure

```
src/
  app/
    api/
      auth/           login, register, logout, me
      properties/     CRUD, photos, sharing
      criteria/       CRUD, reorder
      ratings/        bulk upsert
      formula/        get/update
    dashboard/
      page.tsx        Overview dashboard
      properties/     List, add, edit, view
      evaluate/       Side-by-side compare
      criteria/       Manage criteria
      formula/        Score formula builder
      rankings/       Sorted leaderboard
    auth/
      login/
      register/
  components/
    shared/           Sidebar
    property/         PropertyForm, EvaluatePanel, SharePanel, CompareView
    criteria/         CriteriaManager, FormulaBuilder
  lib/
    prisma.ts         DB client
    session.ts        Auth session
    supabase.ts       Photo storage
    scoring.ts        Score calculation engine
    defaults.ts       Default criteria for new users
  types/index.ts      All TypeScript types
prisma/
  schema.prisma       Database schema (6 tables)
  seed.ts             Default criteria definitions
```

---

## Monthly costs (approximate)

| Service | Tier | Cost |
|---------|------|------|
| Vercel  | Pro  | $20/mo |
| Supabase| Pro  | $25/mo |
| Total   |      | ~$45/mo |

**Free tier alternative** (for light use):  
Vercel Hobby (free) + Supabase Free (500MB, 50k rows) = **$0/mo**  
The free tiers are sufficient for 2 users and ~100 properties.

---

## Useful commands

```bash
npm run dev           # Run locally
npm run db:studio     # Visual database browser (Prisma Studio)
npm run db:push       # Sync schema to database
npm run db:migrate    # Create a migration file
npm run build         # Production build
```

---

## Troubleshooting

**"Invalid session"** — Your `SESSION_SECRET` must be the same across all deployments. Don't regenerate it after users are registered.

**Photos not loading** — Check your Supabase storage bucket is set to **Public** and `SUPABASE_STORAGE_BUCKET` matches the bucket name exactly.

**Database connection errors** — Use the Transaction pooler URL (port 6543) for `DATABASE_URL` and the direct URL (port 5432) for `DIRECT_URL`.

**Prisma type errors** — Run `npm run postinstall` (or `npx prisma generate`) after any schema changes.
