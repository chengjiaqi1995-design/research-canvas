const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const t = await prisma.transcription.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(t.map(x => ({ id: x.id, name: x.fileName, path: x.filePath, size: x.fileSize })));
}
main().catch(console.error).finally(() => prisma.$disconnect());
