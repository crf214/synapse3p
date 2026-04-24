// scripts/patch-missing-users.ts
// One-off: insert missing test users (AUDITOR, LEGAL, CISO) for acme and globex orgs.
// Safe to re-run — uses upsert throughout.

import { PrismaClient, OrgRole } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const MISSING_ROLES: OrgRole[] = [OrgRole.AUDITOR, OrgRole.LEGAL, OrgRole.CISO]
const ORG_SLUGS = ['acme', 'globex']
const PASSWORD = 'password123'

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  const orgs = await prisma.organisation.findMany({
    where: { slug: { in: ORG_SLUGS } },
    select: { id: true, slug: true, name: true },
  })

  if (orgs.length !== ORG_SLUGS.length) {
    const found = orgs.map(o => o.slug)
    const missing = ORG_SLUGS.filter(s => !found.includes(s))
    throw new Error(`Orgs not found: ${missing.join(', ')}`)
  }

  for (const org of orgs) {
    for (const role of MISSING_ROLES) {
      const roleSlug = role.toLowerCase()
      const email    = `${roleSlug}.${org.slug}@test.com`

      const user = await prisma.user.upsert({
        where:  { email },
        update: {},
        create: {
          email,
          name:         `${role} (${org.name})`,
          passwordHash,
          orgId:        org.id,
          role,
        },
      })

      await prisma.orgMember.upsert({
        where:  { orgId_userId: { orgId: org.id, userId: user.id } },
        update: {},
        create: { orgId: org.id, userId: user.id, role },
      })

      console.log(`  upserted: ${email}`)
    }
  }

  // ── Verification ──────────────────────────────────────────────────────────
  console.log('\n── All test users ──────────────────────────────────────────')

  const allUsers = await prisma.user.findMany({
    where:   { email: { endsWith: '@test.com' } },
    select:  { email: true, role: true, orgId: true },
    orderBy: [{ orgId: 'asc' }, { role: 'asc' }],
  })

  const orgMap = Object.fromEntries(orgs.map(o => [o.id, o.slug]))

  let currentOrg = ''
  for (const u of allUsers) {
    const orgSlug = orgMap[u.orgId ?? ''] ?? u.orgId ?? '?'
    if (orgSlug !== currentOrg) {
      console.log(`\n${orgSlug.toUpperCase()}`)
      currentOrg = orgSlug
    }
    console.log(`  ${(u.role ?? '').padEnd(16)}  ${u.email}`)
  }

  console.log(`\nTotal: ${allUsers.length} users`)

  const allRoles = Object.values(OrgRole)
  const missing: string[] = []
  for (const slug of ORG_SLUGS) {
    for (const role of allRoles) {
      const expected = `${role.toLowerCase()}.${slug}@test.com`
      if (!allUsers.find(u => u.email === expected)) missing.push(expected)
    }
  }

  if (missing.length > 0) {
    console.log('\nSTILL MISSING:')
    missing.forEach(e => console.log('  ' + e))
  } else {
    console.log('\nAll roles present for both orgs.')
  }
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
