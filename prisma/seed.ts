import { PrismaClient, OrgRole } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const orgs = [
  { name: 'Acme Corp', slug: 'acme' },
  { name: 'Globex Ltd', slug: 'globex' },
]

const roles: OrgRole[] = [
  OrgRole.ADMIN,
  OrgRole.AP_CLERK,
  OrgRole.FINANCE_MANAGER,
  OrgRole.CONTROLLER,
  OrgRole.CFO,
  OrgRole.VENDOR,
  OrgRole.CLIENT,
  OrgRole.AUDITOR,
]

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10)

  for (const orgData of orgs) {
    const org = await prisma.organisation.upsert({
      where: { slug: orgData.slug },
      update: {},
      create: { name: orgData.name, slug: orgData.slug },
    })

    for (const role of roles) {
      const roleSlug = role.toLowerCase()
      const email = `${roleSlug}.${org.slug}@test.com`

      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email,
          name: `${role} (${org.name})`,
          passwordHash,
          orgId: org.id,
          role,
        },
      })

      await prisma.orgMember.upsert({
        where: { orgId_userId: { orgId: org.id, userId: user.id } },
        update: {},
        create: { orgId: org.id, userId: user.id, role },
      })
    }

    console.log(`Seeded org: ${org.name}`)
  }

  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
