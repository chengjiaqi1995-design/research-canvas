require('dotenv').config();
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.transcription.updateMany({
    where: {
      industry: { in: ['工程机械', '矿山机械', '工程机械/矿山机械'] }
    },
    data: {
      industry: '工程机械/矿山机械'
    }
  });

  console.log(`Merged ${result.count} records back into '工程机械/矿山机械'.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
