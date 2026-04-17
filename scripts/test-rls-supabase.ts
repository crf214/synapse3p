/**
 * True RLS Policy Test — Supabase JS client with user JWTs
 *
 * PREREQUISITE — Supabase Auth users must exist:
 *   This script authenticates via supabase.auth.signInWithPassword(), which
 *   checks Supabase Auth (auth.users), NOT the custom `users` table seeded by
 *   prisma/seed.ts. The seed only writes to the Prisma-managed `users` table.
 *
 *   Before this script will work you must create matching Supabase Auth accounts
 *   for the test users. Options:
 *     A) Supabase dashboard → Authentication → Users → "Invite user" / "Add user"
 *        for admin.acme@test.com and admin.globex@test.com with password "password123"
 *     B) Use the Supabase admin client to call supabase.auth.admin.createUser()
 *        in a separate setup script (requires SUPABASE_SERVICE_KEY).
 *     C) Enable "Email confirmations: off" in Auth settings if email verification
 *        blocks sign-in.
 *
 * RLS LIMITATION REMINDER:
 *   The RLS policies use auth.jwt() ->> 'org_id' and auth.jwt() ->> 'role'.
 *   Supabase does NOT automatically inject custom claims into the JWT — you must
 *   use a custom access token hook or Auth hook to embed orgId/role from your
 *   `users` table into the JWT before these policies will work end-to-end.
 *   Without that hook, auth.jwt() ->> 'org_id' returns NULL and most policies
 *   will deny all reads. See: https://supabase.com/docs/guides/auth/custom-claims-and-role-based-access-control-rbac
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function pass(msg: string) { console.log(`  PASS — ${msg}`) }
function fail(msg: string, data?: unknown) {
  console.log(`  FAIL — ${msg}`)
  if (data !== undefined) console.log('  Data:', JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Use anon key — this is what a real browser client would use.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  // Fetch orgIds using service role so we know what to check against.
  // (We read these from the DB in the previous script — hardcoding would be
  // brittle, so we derive them from a separate admin client here.)
  const { createClient: createAdmin } = await import('@supabase/supabase-js')
  const admin = createAdmin(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY!)

  const { data: orgs, error: orgErr } = await admin
    .from('organisations')
    .select('id, slug')
    .in('slug', ['acme', 'globex'])

  if (orgErr || !orgs || orgs.length < 2) {
    console.error('Could not fetch org IDs via service role:', orgErr?.message)
    console.error('Ensure the seed has been run: npx prisma db seed')
    process.exit(1)
  }

  const acme   = orgs.find(o => o.slug === 'acme')!
  const globex = orgs.find(o => o.slug === 'globex')!
  console.log(`Acme  orgId: ${acme.id}`)
  console.log(`Globex orgId: ${globex.id}`)
  console.log()

  // ---------------------------------------------------------------------------
  // Clear any cached session before signing in
  // ---------------------------------------------------------------------------
  await supabase.auth.signOut()

  // ---------------------------------------------------------------------------
  // Sign in as admin.acme@test.com
  // ---------------------------------------------------------------------------
  console.log('Signing in as admin.acme@test.com ...')
  const { data: authData, error: signInErr } = await supabase.auth.signInWithPassword({
    email: 'admin.acme@test.com',
    password: 'password123',
  })

  if (signInErr || !authData.session) {
    console.error('Sign-in failed:', signInErr?.message)
    console.error()
    console.error('This likely means the user does not exist in Supabase Auth.')
    console.error('See the PREREQUISITE comment at the top of this file.')
    process.exit(1)
  }

  console.log(`Signed in. User ID: ${authData.user?.id}`)

  const { data: { session } } = await supabase.auth.getSession()
  console.log('JWT claims:', JSON.stringify(
    session?.access_token
      ? JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64').toString())
      : 'no session',
    null, 2
  ))
  console.log()

  // ---------------------------------------------------------------------------
  // Test 1: acme user should NOT be able to read globex org
  // ---------------------------------------------------------------------------
  console.log('Test 1: acme user reads globex org (should be blocked by RLS)')
  const { data: crossTenantRows, error: crossErr } = await supabase
    .from('organisations')
    .select('id, name')
    .eq('id', globex.id)

  if (crossErr) {
    // A policy error (PGRST301) is also a valid block
    pass(`query rejected with error: ${crossErr.message}`)
  } else if (!crossTenantRows || crossTenantRows.length === 0) {
    pass('zero rows returned — RLS blocked cross-tenant read')
  } else {
    fail('rows returned that should be invisible to acme user', crossTenantRows)
  }

  // ---------------------------------------------------------------------------
  // Test 2: acme user SHOULD be able to read their own org
  // ---------------------------------------------------------------------------
  console.log()
  console.log('Test 2: acme user reads acme org (should succeed)')
  const { data: ownOrgRows, error: ownErr } = await supabase
    .from('organisations')
    .select('id, name')
    .eq('id', acme.id)

  if (ownErr) {
    fail(`unexpected error reading own org: ${ownErr.message}`)
  } else if (ownOrgRows && ownOrgRows.length === 1) {
    pass(`own org readable — ${ownOrgRows[0].name}`)
  } else {
    fail('own org not returned — RLS may be missing custom JWT claims (see header comment)', ownOrgRows)
  }

  // ---------------------------------------------------------------------------
  // Sign out
  // ---------------------------------------------------------------------------
  await supabase.auth.signOut()
  console.log()
  console.log('Signed out.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
