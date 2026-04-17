import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'admin.acme@test.com' },
    select: { id: true, email: true, orgId: true, role: true },
  })
  console.log(user)
}

main().finally(() => prisma.$disconnect())
