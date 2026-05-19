// One-off local dev seed: minimal data so login works.
// Creates "Acme Corp" + charles.falck@gmail.com ADMIN (password: password123).
// Safe to re-run (uses upsert).

import { PrismaClient, OrgRole } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedInvoiceTemplates } from '../src/lib/workflow-engine/templates/invoice-templates'
import { seedEntityTemplates }  from '../src/lib/workflow-engine/templates/entity-templates'
import { seedPOTemplates }      from '../src/lib/workflow-engine/templates/po-templates'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10)

  const org = await prisma.organisation.upsert({
    where:  { slug: 'acme' },
    update: {},
    create: { name: 'Acme Corp', slug: 'acme' },
  })

  const user = await prisma.user.upsert({
    where:  { email: 'charles.falck@gmail.com' },
    update: { role: OrgRole.ADMIN, orgId: org.id, emailVerified: true },
    create: {
      email:         'charles.falck@gmail.com',
      name:          'Charles Falck',
      passwordHash,
      orgId:         org.id,
      role:          OrgRole.ADMIN,
      emailVerified: true,
    },
  })

  await prisma.orgMember.upsert({
    where:  { orgId_userId: { orgId: org.id, userId: user.id } },
    update: { role: OrgRole.ADMIN, status: 'active' },
    create: { orgId: org.id, userId: user.id, role: OrgRole.ADMIN, status: 'active' },
  })

  console.log(`Seeded org "${org.name}" (${org.slug}) and ADMIN user ${user.email}`)

  await seedInvoiceTemplates(org.id, user.id, prisma)
  await seedEntityTemplates(org.id, user.id, prisma)
  await seedPOTemplates(org.id, user.id, prisma)
  console.log('Seeded workflow templates (invoice, entity, PO)')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
