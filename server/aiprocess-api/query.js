const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const notes = await prisma.transcription.findMany({ select: { fileName: true, summary: true, industry: true, topic: true, organization: true }, take: 20, orderBy: { createdAt: 'desc' } });
  console.log(JSON.stringify(notes, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
