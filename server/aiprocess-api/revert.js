require('dotenv').config({ path: '/Users/jiaqi/ai-note-book-claude-audio-transcription-app-KDXAa/backend/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const fiveMinsAgo = new Date(Date.now() - 30 * 60 * 1000); // 30 mins ago
  const records = await prisma.transcription.findMany({
    where: { 
      updatedAt: { gte: fiveMinsAgo }
    },
    select: { id: true, fileName: true, organization: true, updatedAt: true }
  });

  console.log(`Found ${records.length} records updated in the last 30 minutes`);
  let count = 0;

  for (const r of records) {
    if (!r.fileName) continue;
    const parts = r.fileName.split('-');
    if (parts.length > 1) {
      const oldOrg = parts[1];
      if (r.organization !== oldOrg && r.organization !== '未知' && r.organization !== '未提取') {
        count++;
        // console.log(`Will Revert: ${r.organization} -> ${oldOrg}`);
        
        await prisma.transcription.update({
          where: { id: r.id },
          data: { organization: oldOrg }
        });
      }
    }
  }

  console.log(`Reverted ${count} records successfully.`);
  await prisma.$disconnect();
}

run();
