import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ports = await prisma.portfolioPosition.findMany({
    where: {
      OR: [
        { nameEn: { equals: '' } },
        { nameCn: { equals: '' } }
      ]
    }
  });
  
  console.log(`Found ${ports.length} portfolio records with empty strings.`);
  
  // also get very short names
  const allPorts = await prisma.portfolioPosition.findMany({ select: { id: true, nameCn: true, nameEn: true, tickerBbg: true } });
  const shorts = allPorts.filter(p => (p.nameCn && p.nameCn.length < 2) || (p.nameEn && p.nameEn.length < 2));
  console.log(`Found ${shorts.length} portfolio records with length < 2.`);
  for (const p of shorts) {
    console.log(`- SHORT Portfolio: nameCn="${p.nameCn}", nameEn="${p.nameEn}", ticker="${p.tickerBbg}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
