import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ports = await prisma.portfolioPosition.findMany({
    where: {
      tickerBbg: { contains: '300750' }
    }
  });
  
  console.log(`Found ${ports.length} portfolio records.`);
  for (const p of ports) {
    console.log(`- Portfolio: nameCn="${p.nameCn}", nameEn="${p.nameEn}", ticker="${p.tickerBbg}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
