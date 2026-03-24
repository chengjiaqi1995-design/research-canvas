import { Router } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import * as positionCtrl from '../controllers/portfolio/positionController';
import * as taxonomyCtrl from '../controllers/portfolio/taxonomyController';
import * as summaryCtrl from '../controllers/portfolio/summaryController';
import * as settingsCtrl from '../controllers/portfolio/settingsController';
import * as tradeCtrl from '../controllers/portfolio/tradeController';
import * as researchCtrl from '../controllers/portfolio/researchController';
import * as importCtrl from '../controllers/portfolio/importController';
import * as nameMappingCtrl from '../controllers/portfolio/nameMappingController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// All routes require authentication
router.use(authenticateToken as any);

// Positions
router.get('/positions', asyncHandler(positionCtrl.list));
router.post('/positions', asyncHandler(positionCtrl.create));
router.get('/positions/:id', asyncHandler(positionCtrl.getOne));
router.put('/positions/:id', asyncHandler(positionCtrl.update));
router.delete('/positions/:id', asyncHandler(positionCtrl.remove));

// Taxonomy
router.get('/taxonomy', asyncHandler(taxonomyCtrl.list));
router.post('/taxonomy', asyncHandler(taxonomyCtrl.create));
router.put('/taxonomy/:id', asyncHandler(taxonomyCtrl.update));
router.delete('/taxonomy/:id', asyncHandler(taxonomyCtrl.remove));

// Summary
router.get('/summary', asyncHandler(summaryCtrl.getSummary));

// Settings
router.get('/settings', asyncHandler(settingsCtrl.getSettings));
router.put('/settings', asyncHandler(settingsCtrl.updateSettings));

// Trades
router.get('/trades', asyncHandler(tradeCtrl.list));
router.post('/trades', asyncHandler(tradeCtrl.create));
router.get('/trades/:id', asyncHandler(tradeCtrl.getOne));
router.put('/trades/:id', asyncHandler(tradeCtrl.update));
router.delete('/trades/:id', asyncHandler(tradeCtrl.remove));
router.get('/trades/:id/export', asyncHandler(tradeCtrl.exportTrade));

// Research
router.get('/research', asyncHandler(researchCtrl.list));
router.get('/research/:id', asyncHandler(researchCtrl.getOne));
router.put('/research/:id', asyncHandler(researchCtrl.createOrUpdate));

// Name Mappings
router.get('/name-mappings', asyncHandler(nameMappingCtrl.list));
router.post('/name-mappings', asyncHandler(nameMappingCtrl.create));
router.put('/name-mappings/:id', asyncHandler(nameMappingCtrl.update));
router.delete('/name-mappings/:id', asyncHandler(nameMappingCtrl.remove));

// Import
router.post('/import', upload.single('file'), asyncHandler(importCtrl.importPositions));
router.get('/import-history', asyncHandler(importCtrl.getImportHistory));

// 一次性同步：从原版 Portfolio API 拉取 taxonomy 分类并写入新数据库
// 支持内部调用时通过 query param 指定 targetUserId
router.post('/sync-from-old', asyncHandler(async (req: any, res: any) => {
  let userId = req.userId;
  // 内部调用时允许指定目标用户，或自动查找第一个用户
  if (req.isInternalCall) {
    const prismaDb = (await import('../utils/db')).default;
    if (req.query.targetUserId) {
      userId = req.query.targetUserId;
    } else {
      const firstUser = await prismaDb.user.findFirst();
      if (!firstUser) return res.status(404).json({ success: false, error: 'No users found in database' });
      userId = firstUser.id;
    }
  }
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const OLD_API = 'https://portfolio-manager-208594497704.asia-southeast1.run.app/api';
  const prisma = (await import('../utils/db')).default;

  // 1. 拉原版数据
  const [oldPositions, oldTopdowns, oldSectors, oldThemes]: any[] = await Promise.all([
    fetch(`${OLD_API}/positions`).then(r => r.json()),
    fetch(`${OLD_API}/taxonomy?type=topdown`).then(r => r.json()),
    fetch(`${OLD_API}/taxonomy?type=sector`).then(r => r.json()),
    fetch(`${OLD_API}/taxonomy?type=theme`).then(r => r.json()),
  ]);

  const log: string[] = [];
  log.push(`原版: ${(oldPositions as any[]).length} positions, ${(oldTopdowns as any[]).length} topdowns, ${(oldSectors as any[]).length} sectors, ${(oldThemes as any[]).length} themes`);

  // 2. 创建缺失 taxonomy，建映射
  const createMap = async (items: any[], type: string) => {
    const map = new Map<number, number>();
    for (const t of items) {
      let existing = await prisma.portfolioTaxonomy.findFirst({ where: { type, name: t.name, userId } });
      if (!existing) {
        existing = await prisma.portfolioTaxonomy.create({ data: { type, name: t.name, userId } });
        log.push(`创建 ${type}: ${t.name}`);
      }
      map.set(t.id, existing.id);
    }
    return map;
  };

  const topdownMap = await createMap(oldTopdowns, 'topdown');
  const sectorMap = await createMap(oldSectors, 'sector');
  const themeMap = await createMap(oldThemes, 'theme');

  // 3. 按 ticker 匹配更新分类
  let updated = 0, skipped = 0, notFound = 0;
  for (const oldPos of (oldPositions as any[])) {
    if (!oldPos.ticker) continue;
    const newPos = await prisma.portfolioPosition.findFirst({ where: { tickerBbg: oldPos.ticker, userId } });
    if (!newPos) { notFound++; continue; }

    const data: any = {};
    let changed = false;
    if (oldPos.topdownId && topdownMap.has(oldPos.topdownId) && newPos.topdownId !== topdownMap.get(oldPos.topdownId)) {
      data.topdownId = topdownMap.get(oldPos.topdownId); changed = true;
    }
    if (oldPos.sectorId && sectorMap.has(oldPos.sectorId) && newPos.sectorId !== sectorMap.get(oldPos.sectorId)) {
      data.sectorId = sectorMap.get(oldPos.sectorId); changed = true;
    }
    if (oldPos.themeId && themeMap.has(oldPos.themeId) && newPos.themeId !== themeMap.get(oldPos.themeId)) {
      data.themeId = themeMap.get(oldPos.themeId); changed = true;
    }
    if (oldPos.priority && oldPos.priority !== newPos.priority) {
      data.priority = oldPos.priority; changed = true;
    }

    if (changed) {
      await prisma.portfolioPosition.update({ where: { id: newPos.id }, data });
      updated++;
    } else {
      skipped++;
    }
  }

  log.push(`更新: ${updated}, 无变化: ${skipped}, 未找到: ${notFound}`);
  res.json({ success: true, log });
}));

export default router;
