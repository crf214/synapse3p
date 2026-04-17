import { prisma } from '@/lib/prisma'

async function main() {
  // Resolve acme org
  const acme = await prisma.organisation.findUnique({ where: { slug: 'acme' } })
  if (!acme) {
    console.error('Acme org not found — run: npx prisma db seed')
    process.exit(1)
  }

  // Resolve admin user for alertRecipients
  const adminUser = await prisma.user.findUnique({
    where: { email: 'admin.acme@test.com' },
    select: { id: true },
  })
  if (!adminUser) {
    console.error('admin.acme@test.com not found — run: npx prisma db seed')
    process.exit(1)
  }

  // Find or create entity
  let entity = await prisma.entity.findFirst({ select: { id: true, name: true } })

  if (!entity) {
    entity = await prisma.entity.create({
      data: {
        name:           'Apple Inc',
        slug:           'apple-inc',
        legalStructure: 'COMPANY',
        masterOrgId:    acme.id,
        status:         'ACTIVE',
      },
      select: { id: true, name: true },
    })
    console.log(`Created entity: ${entity.name} (${entity.id})`)
  } else {
    console.log(`Using existing entity: ${entity.name} (${entity.id})`)
  }

  // Upsert signal config
  const config = await prisma.externalSignalConfig.upsert({
    where: { entityId_orgId: { entityId: entity.id, orgId: acme.id } },
    update: {
      signalTypes:       ['NEWS', 'STOCK_PRICE'],
      stockTicker:       'AAPL',
      companyName:       'Apple Inc',
      newsKeywords:      ['Apple', 'Tim Cook'],
      severityThreshold: 'LOW',
      alertRecipients:   [adminUser.id],
      isActive:          true,
    },
    create: {
      entityId:          entity.id,
      orgId:             acme.id,
      signalTypes:       ['NEWS', 'STOCK_PRICE'],
      stockTicker:       'AAPL',
      companyName:       'Apple Inc',
      newsKeywords:      ['Apple', 'Tim Cook'],
      severityThreshold: 'LOW',
      alertRecipients:   [adminUser.id],
      isActive:          true,
    },
  })

  console.log(`Signal config id: ${config.id}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
