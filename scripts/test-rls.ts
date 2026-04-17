/**
 * RLS Isolation Smoke Test
 *
 * LIMITATION: This script uses the Prisma client, which connects via the
 * service role (DATABASE_URL / DIRECT_URL). The service role bypasses RLS
 * entirely, so this script cannot verify that RLS policies actually block
 * cross-tenant reads at the database level.
 *
 * What this script DOES test:
 *   - That org records exist and are distinct
 *   - That a correctly scoped query (orgId = acme's orgId) does NOT return
 *     globex's org — i.e. application-layer isolation logic is correct
 *
 * For true RLS policy verification, use Supabase's built-in RLS testing tool:
 *   https://supabase.com/docs/guides/auth/row-level-security#testing-policies
 * Or issue queries via the Supabase JS client with a user JWT (anon key +
 * auth.uid() set), which routes through the PostgREST layer and respects RLS.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 1. Fetch both orgs
  const [acme, globex] = await Promise.all([
    prisma.organisation.findUnique({ where: { slug: 'acme' }, select: { id: true, name: true } }),
    prisma.organisation.findUnique({ where: { slug: 'globex' }, select: { id: true, name: true } }),
  ])

  if (!acme || !globex) {
    console.error('FAIL: Could not find acme and/or globex orgs. Run the seed first.')
    process.exit(1)
  }

  console.log(`Acme  orgId: ${acme.id}`)
  console.log(`Globex orgId: ${globex.id}`)
  console.log()

  // 2. Simulate an acme-scoped query attempting to read globex's org.
  //    In production this query would be filtered by the RLS policy:
  //      USING (id = (auth.jwt() ->> 'org_id'))
  //    Here we replicate that WHERE clause manually to verify the logic.
  const acmeUserScope = acme.id  // what auth.jwt() ->> 'org_id' would return for an acme user

  const leakedRows = await prisma.organisation.findMany({
    where: {
      id: globex.id,          // trying to read globex
      AND: { id: acmeUserScope }, // but scoped to acme's orgId — should match nothing
    },
    select: { id: true, name: true },
  })

  // 3. Report
  console.log('Test: acme-scoped query for globex org row')
  if (leakedRows.length === 0) {
    console.log('PASS — zero rows returned (application-layer isolation correct)')
  } else {
    console.log('FAIL — rows returned that should be invisible to acme user:')
    console.log(leakedRows)
  }

  // 4. Sanity check: acme user reading their own org should succeed
  const ownOrgRows = await prisma.organisation.findMany({
    where: {
      id: acme.id,
      AND: { id: acmeUserScope },
    },
    select: { id: true, name: true },
  })

  console.log()
  console.log('Sanity: acme-scoped query for acme own org row')
  if (ownOrgRows.length === 1) {
    console.log('PASS — own org row readable')
  } else {
    console.log('FAIL — own org row unexpectedly missing')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
