/**
 * 迁移脚本：将现有 PortfolioPosition 的 sector.name (外键关联) 复制到 sectorName (字符串字段)
 *
 * 运行方式: npx tsx scripts/migrate-sector-names.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const positions = await prisma.portfolioPosition.findMany({
    where: {
      sectorId: { not: null },
      sectorName: '',
    },
    include: { sector: true },
  });

  console.log(`找到 ${positions.length} 个需要迁移的持仓`);

  let updated = 0;
  for (const pos of positions) {
    if (pos.sector?.name) {
      await prisma.portfolioPosition.update({
        where: { id: pos.id },
        data: { sectorName: pos.sector.name },
      });
      console.log(`  ✅ ${pos.nameEn || pos.tickerBbg}: ${pos.sector.name}`);
      updated++;
    }
  }

  console.log(`\n迁移完成：${updated} 个持仓已更新`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
