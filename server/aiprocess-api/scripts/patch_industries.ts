import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const t1 = await prisma.transcription.updateMany({
    where: { industry: '铜' },
    data: { industry: '铜金' }
  });

  const t2 = await prisma.transcription.updateMany({
    where: { industry: '工程机械/矿山机械' },
    data: { industry: '工程机械' } // default split fallback
  });

  console.log(`Updated ${t1.count} records from 铜 to 铜金.`);
  console.log(`Updated ${t2.count} records from 工程机械/矿山机械 to 工程机械.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
