import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} users`);
  for (const u of users) {
    const c = await prisma.portfolioPosition.count({ where: { userId: u.id } });
    console.log(`User ${u.email} (ID: ${u.id}) has ${c} positions`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
