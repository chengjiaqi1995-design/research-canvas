const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const notes = await prisma.transcription.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      industry: true,
      organization: true
    }
  });
  console.log(JSON.stringify(notes, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
