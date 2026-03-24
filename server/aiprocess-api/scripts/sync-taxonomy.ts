/**
 * 从原版 Portfolio（线上）同步 taxonomy 分类到新数据库
 *
 * 步骤：
 * 1. 读取线上 taxonomy（topdown/sector/theme）和 positions
 * 2. 在新数据库中创建缺失的 taxonomy
 * 3. 按 ticker 匹配 positions，更新 topdownId/sectorId/themeId
 *
 * 运行: npx tsx scripts/sync-taxonomy.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 你的 userId（从日志中获取）
const USER_ID = 'd1c31c0c-0aa3-4ad7-8f84-f8c1b2fb1454';

async function main() {
  // 1. 读取下载的数据
  const fs = await import('fs');
  const oldPositions = JSON.parse(fs.readFileSync('/tmp/portfolio_positions.json', 'utf8'));
  const oldTopdowns = JSON.parse(fs.readFileSync('/tmp/portfolio_topdown.json', 'utf8'));
  const oldSectors = JSON.parse(fs.readFileSync('/tmp/portfolio_sector.json', 'utf8'));
  const oldThemes = JSON.parse(fs.readFileSync('/tmp/portfolio_theme.json', 'utf8'));

  console.log(`📦 原版数据: ${oldPositions.length} positions, ${oldTopdowns.length} topdowns, ${oldSectors.length} sectors, ${oldThemes.length} themes`);

  // 2. 确保新数据库中有所有 taxonomy
  // oldId → newId 映射
  const topdownMap = new Map<number, number>();
  const sectorMap = new Map<number, number>();
  const themeMap = new Map<number, number>();

  for (const t of oldTopdowns) {
    const existing = await prisma.portfolioTaxonomy.findFirst({
      where: { type: 'topdown', name: t.name, userId: USER_ID },
    });
    if (existing) {
      topdownMap.set(t.id, existing.id);
    } else {
      const created = await prisma.portfolioTaxonomy.create({
        data: { type: 'topdown', name: t.name, userId: USER_ID },
      });
      topdownMap.set(t.id, created.id);
      console.log(`  ✅ 创建 topdown: ${t.name} (${t.id} → ${created.id})`);
    }
  }

  for (const t of oldSectors) {
    const existing = await prisma.portfolioTaxonomy.findFirst({
      where: { type: 'sector', name: t.name, userId: USER_ID },
    });
    if (existing) {
      sectorMap.set(t.id, existing.id);
    } else {
      const created = await prisma.portfolioTaxonomy.create({
        data: { type: 'sector', name: t.name, userId: USER_ID },
      });
      sectorMap.set(t.id, created.id);
      console.log(`  ✅ 创建 sector: ${t.name} (${t.id} → ${created.id})`);
    }
  }

  for (const t of oldThemes) {
    const existing = await prisma.portfolioTaxonomy.findFirst({
      where: { type: 'theme', name: t.name, userId: USER_ID },
    });
    if (existing) {
      themeMap.set(t.id, existing.id);
    } else {
      const created = await prisma.portfolioTaxonomy.create({
        data: { type: 'theme', name: t.name, userId: USER_ID },
      });
      themeMap.set(t.id, created.id);
      console.log(`  ✅ 创建 theme: ${t.name} (${t.id} → ${created.id})`);
    }
  }

  console.log(`\n📊 Taxonomy 映射: ${topdownMap.size} topdowns, ${sectorMap.size} sectors, ${themeMap.size} themes`);

  // 3. 按 ticker 匹配 positions，更新分类
  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const oldPos of oldPositions) {
    const ticker = oldPos.ticker;
    if (!ticker) continue;

    // 查找新数据库中匹配的 position
    const newPos = await prisma.portfolioPosition.findFirst({
      where: { ticker, userId: USER_ID },
    });

    if (!newPos) {
      notFound++;
      continue;
    }

    // 构建更新数据
    const updateData: any = {};
    let changed = false;

    if (oldPos.topdownId && topdownMap.has(oldPos.topdownId)) {
      const newTopdownId = topdownMap.get(oldPos.topdownId)!;
      if (newPos.topdownId !== newTopdownId) {
        updateData.topdownId = newTopdownId;
        changed = true;
      }
    }

    if (oldPos.sectorId && sectorMap.has(oldPos.sectorId)) {
      const newSectorId = sectorMap.get(oldPos.sectorId)!;
      if (newPos.sectorId !== newSectorId) {
        updateData.sectorId = newSectorId;
        changed = true;
      }
    }

    if (oldPos.themeId && themeMap.has(oldPos.themeId)) {
      const newThemeId = themeMap.get(oldPos.themeId)!;
      if (newPos.themeId !== newThemeId) {
        updateData.themeId = newThemeId;
        changed = true;
      }
    }

    // 同步 priority
    if (oldPos.priority && oldPos.priority !== newPos.priority) {
      updateData.priority = oldPos.priority;
      changed = true;
    }

    if (changed) {
      await prisma.portfolioPosition.update({
        where: { id: newPos.id },
        data: updateData,
      });
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`\n✅ 同步完成:`);
  console.log(`  更新: ${updated}`);
  console.log(`  无变化: ${skipped}`);
  console.log(`  未找到: ${notFound}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
