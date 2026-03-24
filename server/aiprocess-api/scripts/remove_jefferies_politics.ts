require('dotenv').config();
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.transcription.updateMany({
    where: {
      industry: '政治',
      organization: { contains: 'Jefferies' }
    },
    data: {
      organization: ''
    }
  });

  console.log(`Updated ${result.count} records. Successfully removed Jefferies from politics notes.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
