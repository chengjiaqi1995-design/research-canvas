import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const t1 = await prisma.transcription.updateMany({
    where: { organization: { in: ['[Private] Chery Automobile', 'Chery Automobile'] } },
    data: { organization: '[9973 HK] 奇瑞汽车' }
  });
  
  const t2 = await prisma.transcription.updateMany({
    where: { organization: { in: ['[Private] Zhejiang Taotao Vehicles', 'Zhejiang Taotao Vehicles', '[Private] Zhejiang Taotao Vehicles '] } },
    data: { organization: '[301345 CH] 涛涛车业' }
  });

  const t3 = await prisma.transcription.updateMany({
    where: { organization: { in: ['[Private] 山东临工工程机械有限公司', '山东临工工程机械有限公司', '[Private] 山东临工'] } },
    data: { organization: '[600162 CH] 山东临工' }
  });

  // Find a valid userId to connect to
  const anyUser = await prisma.user.findFirst();
  if (!anyUser) {
    console.log("No user found, exiting portfolio creation.");
    return;
  }
  const userId = anyUser.id;

  // Insert into Portfolio to prevent future hallucinations
  const ports = [
    { tickerBbg: '9973 HK Equity', nameCn: '奇瑞汽车', nameEn: 'Chery Automobile', market: '', userId },
    { tickerBbg: '301345 CH Equity', nameCn: '涛涛车业', nameEn: 'Zhejiang Taotao Vehicles', market: '', userId },
    { tickerBbg: '600162 CH Equity', nameCn: '山东临工', nameEn: 'Shandong Lingong', market: '', userId }
  ];

  for (const p of ports) {
    const exists = await prisma.portfolioPosition.findFirst({ where: { tickerBbg: p.tickerBbg, userId } });
    if (!exists) {
      await prisma.portfolioPosition.create({ data: p });
      console.log(`Added ${p.nameCn} to Portfolio.`);
    }
  }

  console.log(`Updated ${t1.count} Chery records, ${t2.count} Taotao records, ${t3.count} Lingong records.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
