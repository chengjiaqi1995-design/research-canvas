import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ports = await prisma.portfolioPosition.findMany({
    where: {
      OR: [
        { nameEn: { in: ['Fluence', 'Eaton', 'Keyence'] } },
        { nameCn: { in: ['福特', '伊顿', '基恩士'] } },
        { tickerBbg: { contains: 'FLNC' } },
        { tickerBbg: { contains: 'ETN' } },
        { tickerBbg: { contains: '6861' } }
      ]
    }
  });
  
  console.log(`Found ${ports.length} portfolio records.`);
  for (const p of ports) {
    console.log(`- Portfolio: nameCn="${p.nameCn}", nameEn="${p.nameEn}", ticker="${p.tickerBbg}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
