import { PrismaClient } from '@prisma/client'

// Load .env if dotenv is available, otherwise rely on environment
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv')
  dotenv.config()
} catch { /* dotenv not installed, env vars must be set externally */ }

const prisma = new PrismaClient()

async function main() {
  const existing = await prisma.serviceCatalogue.count()
  if (existing > 0) {
    console.log(`Already seeded (${existing} entries). Skipping.`)
    return
  }

  const roots = [
    { name: 'Financial Services',     children: ['Banking', 'Custody', 'Fund Administration', 'Prime Brokerage'] },
    { name: 'Professional Services',  children: ['Legal', 'Audit', 'Compliance', 'Technology', 'Outsourcing'] },
    { name: 'Real Estate',            children: [] },
    { name: 'Catering / Hospitality', children: [] },
    { name: 'Travel',                 children: [] },
  ]

  for (let i = 0; i < roots.length; i++) {
    const { name, children } = roots[i]
    const parent = await prisma.serviceCatalogue.create({
      data: { name, sortOrder: i },
    })
    for (let j = 0; j < children.length; j++) {
      await prisma.serviceCatalogue.create({
        data: { name: children[j], parentId: parent.id, sortOrder: j },
      })
    }
    console.log(`Created: ${name} with ${children.length} children`)
  }
  console.log('Seed complete.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
