import { Request, Response } from 'express';
import prisma from '../../utils/db';
import * as svc from '../../services/portfolioService';

/**
 * 模糊匹配 Excel 列名（大小写不敏感，子串匹配）
 * 与 Portfolio 原版逻辑一致
 */
function findColumn(row: Record<string, unknown>, ...keywords: string[]): string {
  for (const key of Object.keys(row)) {
    const lk = key.toLowerCase().trim();
    if (keywords.every(kw => lk.includes(kw.toLowerCase()))) {
      return String(row[key] ?? '').trim();
    }
  }
  return '';
}

export async function importPositions(req: Request, res: Response) {
  const userId = req.userId!;

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const XLSX = await import('xlsx');
  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

  if (!rows.length) {
    return res.status(400).json({ success: false, error: 'Empty spreadsheet' });
  }

  const aum = await svc.getAum(userId);

  // Get name mappings for matching Bloomberg names to Chinese names
  const nameMappings = await prisma.portfolioNameMapping.findMany({ where: { userId } });
  const nameMap = new Map(nameMappings.map(m => [m.bbgName.toLowerCase(), m]));

  // Reset all active positions to watchlist state before import
  // Prevents ghost positions (sold stocks not in new file) from accumulating
  await prisma.portfolioPosition.updateMany({
    where: { userId, longShort: { in: ['long', 'short'] } },
    data: { longShort: '/', positionAmount: 0, positionWeight: 0 },
  });

  let total = 0;
  let updated = 0;
  let created = 0;
  const unmatched: { bbgName: string }[] = [];
  const importedWithNmv = new Set<string>();

  for (const row of rows) {
    // Match column names using flexible substring matching (Bloomberg exports vary)
    const bbgName = findColumn(row, 'underlying') || String(row['Underlying_Description'] ?? '').trim();
    const tickerBbg = findColumn(row, 'yellow key') || findColumn(row, 'bb yellow') || String(row['BB Yellow Key'] ?? '').trim();
    const riskCountry = findColumn(row, 'risk country');
    const gicIndustry = findColumn(row, 'gic', 'industry');
    const exchangeCountry = findColumn(row, 'exchange', 'country');
    const pnlRaw = findColumn(row, 'pnl') || findColumn(row, 'p&l') || findColumn(row, 'unrealized');
    const pnl = parseFloat(pnlRaw.replace(/,/g, '')) || 0;

    // Skip empty/summary rows
    if (!tickerBbg || tickerBbg === 'Total') continue;
    if (bbgName === 'Total' || bbgName.startsWith('Applied filters')) continue;

    total++;

    // Find NMV: prefer "Latest NMV", fallback to "NMV excl Cash", then any "NMV" (not "Avg")
    let nmvRaw: unknown = '0';
    for (const key of Object.keys(row)) {
      if (key.toLowerCase().includes('latest nmv')) { nmvRaw = row[key]; break; }
    }
    if (nmvRaw === '0') {
      for (const key of Object.keys(row)) {
        if (key.toLowerCase().includes('nmv excl cash')) { nmvRaw = row[key]; break; }
      }
    }
    if (nmvRaw === '0') {
      for (const key of Object.keys(row)) {
        const lk = key.toLowerCase();
        if (lk.includes('nmv') && !lk.includes('avg')) { nmvRaw = row[key]; break; }
      }
    }

    const nmvExclCash = parseFloat(String(nmvRaw).replace(/,/g, ''));

    // Skip duplicate rows with no NMV if we already have valid data
    if ((isNaN(nmvExclCash) || nmvExclCash === 0) && importedWithNmv.has(tickerBbg)) {
      continue;
    }

    // Use Avg NMV to determine direction for closed positions (NMV = 0)
    let avgNmv = 0;
    for (const key of Object.keys(row)) {
      if (key.toLowerCase().includes('avg nmv')) {
        avgNmv = parseFloat(String(row[key]).replace(/,/g, '')) || 0;
        break;
      }
    }

    // Resolve Chinese name from mapping
    const mapping = nameMap.get(bbgName.toLowerCase());
    const chineseName = mapping ? mapping.chineseName : '';

    if (!mapping && bbgName && !unmatched.some(u => u.bbgName === bbgName)) {
      unmatched.push({ bbgName });
    }

    // Determine long/short
    let longShort = '/';
    if (nmvExclCash > 0) longShort = 'long';
    else if (nmvExclCash < 0) longShort = 'short';
    else if (nmvExclCash === 0 && avgNmv !== 0) {
      longShort = avgNmv > 0 ? 'long' : 'short';
    }

    const positionAmount = Math.abs(nmvExclCash) || 0;
    const positionWeight = aum > 0 ? positionAmount / aum : 0;
    const market = riskCountry;

    // Upsert position (preserve user-set taxonomy fields)
    const existing = await prisma.portfolioPosition.findFirst({
      where: { userId, tickerBbg },
    });

    if (existing) {
      await prisma.portfolioPosition.update({
        where: { id: existing.id },
        data: {
          nameEn: bbgName || existing.nameEn,
          nameCn: chineseName || existing.nameCn,
          market: market || existing.market,
          longShort,
          positionAmount,
          positionWeight,
          gicIndustry: gicIndustry || existing.gicIndustry,
          exchangeCountry: exchangeCountry || existing.exchangeCountry,
          pnl,
          // sectorId, themeId, topdownId, priority NOT overwritten
        },
      });
      updated++;
    } else {
      await prisma.portfolioPosition.create({
        data: {
          tickerBbg,
          nameEn: bbgName,
          nameCn: chineseName,
          market,
          longShort,
          positionAmount,
          positionWeight,
          gicIndustry,
          exchangeCountry,
          pnl,
          userId,
        },
      });
      created++;
    }

    if (!isNaN(nmvExclCash) && nmvExclCash !== 0) {
      importedWithNmv.add(tickerBbg);
    }
  }

  // Record import history
  await prisma.portfolioImportHistory.create({
    data: {
      importType: 'positions',
      fileName: req.file.originalname || 'import.xlsx',
      recordCount: total,
      newCount: created,
      updatedCount: updated,
      userId,
    },
  });

  res.json({
    success: true,
    data: {
      total,
      newCount: created,
      updatedCount: updated,
      totalCount: created + updated,
      unmatched,
      excelColumns: rows.length > 0 ? Object.keys(rows[0]) : [],
    },
  });
}

export async function getImportHistory(req: Request, res: Response) {
  const userId = req.userId!;
  const history = await prisma.portfolioImportHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json({ success: true, data: history });
}
