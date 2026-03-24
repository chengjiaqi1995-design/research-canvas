import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.transcription.findMany({
    where: {
      organization: {
        in: ['BP', 'Chevron', 'Baker Hughes', 'Baker']
      }
    },
    select: { id: true, organization: true }
  });
  
  console.log(`Found ${orgs.length} records.`);
  for (const org of orgs) {
    console.log(`- Org: "${org.organization}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
