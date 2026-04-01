const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const notes = await prisma.transcription.findMany({
    where: {
      fileName: {
        in: ['大马力柴油发电机市场趋势与潍柴动力布局-[000338 CH] 潍柴动力股份有限公司-Third Bridge-expert-中国-2026/3/18', '欧洲公用事业多空辩论--Bank of America-sellside-欧洲-2026/4/1']
      }
    },
    select: {
      id: true,
      fileName: true,
      industry: true,
      organization: true,
      tags: true
    }
  });
  console.log(JSON.stringify(notes, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
