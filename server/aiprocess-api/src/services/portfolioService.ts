import prisma from '../utils/db';
import type { Prisma } from '@prisma/client';

// ============ Types ============

export interface SummaryByDimension {
  name: string;
  long: number;
  short: number;
  nmv: number;
  gmv: number;
  pnl: number;
}

export interface PortfolioSummary {
  aum: number;
  totalLong: number;
  totalShort: number;
  totalPnl: number;
  nmv: number;
  gmv: number;
  longCount: number;
  shortCount: number;
  watchlistCount: number;
  bySector: SummaryByDimension[];
  byIndustry: SummaryByDimension[];
  byTheme: SummaryByDimension[];
  byTopdown: SummaryByDimension[];
  byRiskCountry: SummaryByDimension[];
  byGicIndustry: SummaryByDimension[];
  byExchangeCountry: SummaryByDimension[];
}

export interface PositionFilters {
  longShort?: string;
  search?: string;
}

// The include object reused for position queries with taxonomy relations
const POSITION_INCLUDE = {
  sector: true,
  theme: true,
  topdown: true,
} as const;

// ============ AUM ============

export async function getAum(userId: string): Promise<number> {
  const settings = await prisma.portfolioSettings.findUnique({
    where: { userId },
  });
  return settings?.aum ?? 10_000_000;
}

export async function updateAum(userId: string, aum: number): Promise<void> {
  await prisma.portfolioSettings.upsert({
    where: { userId },
    update: { aum },
    create: { userId, aum },
  });
}

// ============ Positions ============

export async function getAllPositions(userId: string, filters?: PositionFilters) {
  const where: Prisma.PortfolioPositionWhereInput = { userId };

  if (filters?.longShort) {
    where.longShort = filters.longShort;
  }

  if (filters?.search) {
    where.OR = [
      { nameCn: { contains: filters.search, mode: 'insensitive' } },
      { nameEn: { contains: filters.search, mode: 'insensitive' } },
      { tickerBbg: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const positions = await prisma.portfolioPosition.findMany({
    where,
    include: POSITION_INCLUDE,
    orderBy: { positionAmount: 'desc' },
  });

  // Sort by absolute positionAmount descending (Prisma doesn't support ABS ordering natively)
  positions.sort((a, b) => Math.abs(b.positionAmount) - Math.abs(a.positionAmount));

  return positions;
}

export async function getPositionById(userId: string, id: number) {
  return prisma.portfolioPosition.findFirst({
    where: { id, userId },
    include: POSITION_INCLUDE,
  });
}

export async function createPosition(
  userId: string,
  data: Prisma.PortfolioPositionCreateInput & { sectorId?: number | null; themeId?: number | null; topdownId?: number | null },
) {
  // Extract relation IDs and build the create payload
  const { sectorId, themeId, topdownId, ...rest } = data;

  return prisma.portfolioPosition.create({
    data: {
      ...rest,
      user: { connect: { id: userId } },
      ...(sectorId != null ? { sector: { connect: { id: sectorId } } } : {}),
      ...(themeId != null ? { theme: { connect: { id: themeId } } } : {}),
      ...(topdownId != null ? { topdown: { connect: { id: topdownId } } } : {}),
    },
    include: POSITION_INCLUDE,
  });
}

export async function updatePosition(
  userId: string,
  id: number,
  data: Record<string, unknown>,
) {
  // Verify ownership
  const existing = await prisma.portfolioPosition.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Position not found');

  const { sectorId, sectorName, themeId, topdownId, ...rest } = data;

  // Build update payload with proper relation handling
  const updateData: Prisma.PortfolioPositionUpdateInput = { ...rest };

  // sectorName: direct string field (unified industry from Canvas categories)
  if (sectorName !== undefined) {
    updateData.sectorName = (sectorName as string) || '';
  }

  if (sectorId !== undefined) {
    updateData.sector = sectorId != null
      ? { connect: { id: sectorId as number } }
      : { disconnect: true };
  }
  if (themeId !== undefined) {
    updateData.theme = themeId != null
      ? { connect: { id: themeId as number } }
      : { disconnect: true };
  }
  if (topdownId !== undefined) {
    updateData.topdown = topdownId != null
      ? { connect: { id: topdownId as number } }
      : { disconnect: true };
  }

  const updated = await prisma.portfolioPosition.update({
    where: { id },
    data: updateData,
    include: POSITION_INCLUDE,
  });

  // Propagate sector/theme/topdown changes to all positions with the same ticker
  // (different exchanges for the same company should share taxonomy assignments)
  if (sectorId !== undefined || sectorName !== undefined || themeId !== undefined || topdownId !== undefined) {
    const propagateData: Record<string, unknown> = {};
    if (sectorId !== undefined) propagateData.sectorId = sectorId as number | null;
    if (sectorName !== undefined) propagateData.sectorName = (sectorName as string) || '';
    if (themeId !== undefined) propagateData.themeId = themeId as number | null;
    if (topdownId !== undefined) propagateData.topdownId = topdownId as number | null;

    // Normalize the ticker base (strip exchange suffix patterns) to find related positions
    // For now, propagate to positions sharing the same nameEn (cross-listed tickers)
    const normalizedKey = normalizeCompanyKey(existing.nameEn || existing.tickerBbg);

    // Pre-filter at DB level using LIKE on the base name to reduce data transfer
    const baseNamePrefix = normalizedKey.split(' ')[0]; // Use first word for DB filter
    const candidatePositions = await prisma.portfolioPosition.findMany({
      where: {
        userId,
        id: { not: id },
        nameEn: { contains: baseNamePrefix, mode: 'insensitive' },
      },
      select: { id: true, nameEn: true, tickerBbg: true },
    });

    const relatedIds = candidatePositions
      .filter(
        (p) => normalizeCompanyKey(p.nameEn || p.tickerBbg) === normalizedKey,
      )
      .map((p) => p.id);

    if (relatedIds.length > 0) {
      // Build direct update for related positions (updateMany doesn't handle relations)
      const directUpdate: Record<string, unknown> = {};
      if (sectorId !== undefined) directUpdate.sectorId = sectorId;
      if (themeId !== undefined) directUpdate.themeId = themeId;
      if (topdownId !== undefined) directUpdate.topdownId = topdownId;

      await prisma.portfolioPosition.updateMany({
        where: { id: { in: relatedIds }, userId },
        data: directUpdate,
      });
    }
  }

  return updated;
}

export async function deletePosition(userId: string, id: number) {
  // Verify ownership
  const existing = await prisma.portfolioPosition.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Position not found');

  return prisma.portfolioPosition.delete({ where: { id } });
}

// ============ Normalize company key ============

/**
 * Normalize company names to merge cross-listed tickers.
 * e.g. "SANHUA ORD A" + "SANHUA ORD H" -> "SANHUA"
 *      "BYD COMPANY ORD H" -> "BYD"
 */
export function normalizeCompanyKey(nameEn: string): string {
  return nameEn
    .replace(/\s+ORD\s+[A-Z]$/i, '')    // Remove "ORD A", "ORD H"
    .replace(/\s+COMPANY/i, '')          // Remove "COMPANY"
    .replace(/\s+ORD$/i, '')             // Remove trailing "ORD"
    .trim();
}

// ============ Portfolio Summary ============

export async function getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
  const aum = await getAum(userId);

  const watchlistCount = await prisma.portfolioPosition.count({
    where: { userId, longShort: '/' },
  });

  // Get all active + closed-with-pnl positions in a single query
  const allPositions = await prisma.portfolioPosition.findMany({
    where: {
      userId,
      OR: [
        { longShort: { in: ['long', 'short'] } },
        { longShort: '/', NOT: { pnl: 0 } },
      ],
    },
    include: POSITION_INCLUDE,
  });

  const positionsWithNames = allPositions.filter(p => p.longShort === 'long' || p.longShort === 'short');

  // --- Step 1: Merge positions by normalized company name ---
  const companyMap = new Map<
    string,
    {
      signedNmv: number;
      pnl: number;
      market: string;
      sectorName: string;
      themeName: string;
      topdownName: string;
      gicIndustry: string;
      exchangeCountry: string;
    }
  >();

  for (const p of positionsWithNames) {
    const key = normalizeCompanyKey(p.nameEn || p.tickerBbg);
    const signedNmv = p.longShort === 'long' ? p.positionAmount : -p.positionAmount;

    if (companyMap.has(key)) {
      const existing = companyMap.get(key)!;
      existing.signedNmv += signedNmv;
      existing.pnl += p.pnl || 0;
      // Keep first non-empty values for dimensions
      if (!existing.market && p.market) existing.market = p.market;
      if (!existing.sectorName && (p.sectorName || p.sector?.name)) existing.sectorName = p.sectorName || p.sector?.name || '';
      if (!existing.themeName && p.theme?.name) existing.themeName = p.theme.name;
      if (!existing.topdownName && p.topdown?.name) existing.topdownName = p.topdown.name;
      if (!existing.gicIndustry && p.gicIndustry) existing.gicIndustry = p.gicIndustry;
      if (!existing.exchangeCountry && p.exchangeCountry) existing.exchangeCountry = p.exchangeCountry;
    } else {
      companyMap.set(key, {
        signedNmv,
        pnl: p.pnl || 0,
        market: p.market || '',
        sectorName: p.sectorName || p.sector?.name || '',
        themeName: p.theme?.name || '',
        topdownName: p.topdown?.name || '',
        gicIndustry: p.gicIndustry || '',
        exchangeCountry: p.exchangeCountry || '',
      });
    }
  }

  // --- Step 2: Aggregate on merged companies ---
  let totalLong = 0;
  let totalShort = 0;
  let totalPnl = 0;
  let longCount = 0;
  let shortCount = 0;

  const bySectorMap = new Map<string, SummaryByDimension>();
  const byIndustryMap = new Map<string, SummaryByDimension>();
  const byThemeMap = new Map<string, SummaryByDimension>();
  const byTopdownMap = new Map<string, SummaryByDimension>();
  const byRiskCountryMap = new Map<string, SummaryByDimension>();
  const byGicIndustryMap = new Map<string, SummaryByDimension>();
  const byExchangeCountryMap = new Map<string, SummaryByDimension>();

  /** Helper to add a merged company to a dimension breakdown map */
  const addToDim = (
    map: Map<string, SummaryByDimension>,
    dimName: string,
    isLong: boolean,
    weight: number,
    pnl: number,
  ) => {
    if (!map.has(dimName)) {
      map.set(dimName, { name: dimName, long: 0, short: 0, nmv: 0, gmv: 0, pnl: 0 });
    }
    const d = map.get(dimName)!;
    if (isLong) d.long += weight;
    else d.short -= weight;
    d.nmv = d.long + d.short;
    d.gmv = d.long + Math.abs(d.short);
    d.pnl += pnl;
  };

  for (const [, company] of companyMap) {
    const isLong = company.signedNmv >= 0;
    const weight = Math.abs(company.signedNmv) / aum;
    const pnl = company.pnl;

    totalPnl += pnl;

    if (isLong) {
      totalLong += weight;
      longCount++;
    } else {
      totalShort -= weight; // short is negative
      shortCount++;
    }

    // Taxonomy-based dimensions
    addToDim(bySectorMap, company.market || '其他', isLong, weight, pnl);
    addToDim(byIndustryMap, company.sectorName || '其他', isLong, weight, pnl);
    addToDim(byThemeMap, company.themeName || '其他', isLong, weight, pnl);
    addToDim(byTopdownMap, company.topdownName || '其他', isLong, weight, pnl);

    // Native dimensions
    addToDim(byRiskCountryMap, company.market || '其他', isLong, weight, pnl);
    addToDim(byGicIndustryMap, company.gicIndustry || '其他', isLong, weight, pnl);
    addToDim(byExchangeCountryMap, company.exchangeCountry || '其他', isLong, weight, pnl);
  }

  // --- Step 3: Include PNL from closed/watchlist positions (NMV=0 but PNL != 0) ---
  const closedWithPnl = allPositions.filter(p => p.longShort === '/' && p.pnl !== 0);

  /** Helper to add PNL-only (no exposure contribution) to a dimension map */
  const addPnlToDim = (
    map: Map<string, SummaryByDimension>,
    dimName: string,
    pnl: number,
  ) => {
    if (!map.has(dimName)) {
      map.set(dimName, { name: dimName, long: 0, short: 0, nmv: 0, gmv: 0, pnl: 0 });
    }
    map.get(dimName)!.pnl += pnl;
  };

  for (const p of closedWithPnl) {
    const pnl = p.pnl || 0;
    totalPnl += pnl;

    addPnlToDim(bySectorMap, p.market || '其他', pnl);
    addPnlToDim(byIndustryMap, p.sector?.name || '其他', pnl);
    addPnlToDim(byThemeMap, p.theme?.name || '其他', pnl);
    addPnlToDim(byTopdownMap, p.topdown?.name || '其他', pnl);
    addPnlToDim(byRiskCountryMap, p.market || '其他', pnl);
    addPnlToDim(byGicIndustryMap, p.gicIndustry || '其他', pnl);
    addPnlToDim(byExchangeCountryMap, p.exchangeCountry || '其他', pnl);
  }

  const sortByGmvDesc = (a: SummaryByDimension, b: SummaryByDimension) => b.gmv - a.gmv;

  return {
    aum,
    totalLong,
    totalShort,
    totalPnl,
    nmv: totalLong + totalShort,
    gmv: totalLong + Math.abs(totalShort),
    longCount,
    shortCount,
    watchlistCount,
    bySector: [...bySectorMap.values()].sort(sortByGmvDesc),
    byIndustry: [...byIndustryMap.values()].sort(sortByGmvDesc),
    byTheme: [...byThemeMap.values()].sort(sortByGmvDesc),
    byTopdown: [...byTopdownMap.values()].sort(sortByGmvDesc),
    byRiskCountry: [...byRiskCountryMap.values()].sort(sortByGmvDesc),
    byGicIndustry: [...byGicIndustryMap.values()].sort(sortByGmvDesc),
    byExchangeCountry: [...byExchangeCountryMap.values()].sort(sortByGmvDesc),
  };
}

// ============ Taxonomies ============

export async function getAllTaxonomies(userId: string, type?: string) {
  const where: Prisma.PortfolioTaxonomyWhereInput = { userId };
  if (type) where.type = type;

  return prisma.portfolioTaxonomy.findMany({
    where,
    include: { children: true, parent: true },
    orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function createTaxonomy(
  userId: string,
  data: { type: string; name: string; parentId?: number | null; sortOrder?: number },
) {
  return prisma.portfolioTaxonomy.create({
    data: {
      type: data.type,
      name: data.name,
      parentId: data.parentId ?? null,
      sortOrder: data.sortOrder ?? 0,
      userId,
    },
    include: { children: true, parent: true },
  });
}

export async function updateTaxonomy(
  userId: string,
  id: number,
  data: { name?: string; parentId?: number | null; sortOrder?: number },
) {
  // Verify ownership
  const existing = await prisma.portfolioTaxonomy.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Taxonomy not found');

  return prisma.portfolioTaxonomy.update({
    where: { id },
    data,
    include: { children: true, parent: true },
  });
}

export async function deleteTaxonomy(userId: string, id: number) {
  const existing = await prisma.portfolioTaxonomy.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Taxonomy not found');

  // Nullify references in positions before deleting
  const nullifyField =
    existing.type === 'sector'
      ? 'sectorId'
      : existing.type === 'theme'
        ? 'themeId'
        : 'topdownId';

  await prisma.$transaction([
    prisma.portfolioPosition.updateMany({
      where: { userId, [nullifyField]: id },
      data: { [nullifyField]: null },
    }),
    prisma.portfolioTaxonomy.delete({ where: { id } }),
  ]);
}

// ============ Settings ============

export async function getSettings(userId: string) {
  return prisma.portfolioSettings.findUnique({
    where: { userId },
  });
}

export async function updateSettings(
  userId: string,
  data: { aum?: number; aiProviders?: string },
) {
  return prisma.portfolioSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

// ============ Name Mappings ============

export async function getNameMappings(userId: string) {
  return prisma.portfolioNameMapping.findMany({
    where: { userId },
    include: { position: true },
    orderBy: { bbgName: 'asc' },
  });
}

export async function createNameMapping(
  userId: string,
  data: { bbgName: string; chineseName: string; positionId?: number | null },
) {
  return prisma.portfolioNameMapping.create({
    data: {
      bbgName: data.bbgName,
      chineseName: data.chineseName,
      positionId: data.positionId ?? null,
      userId,
    },
    include: { position: true },
  });
}

export async function updateNameMapping(
  userId: string,
  id: number,
  data: { bbgName?: string; chineseName?: string; positionId?: number | null },
) {
  const existing = await prisma.portfolioNameMapping.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Name mapping not found');

  return prisma.portfolioNameMapping.update({
    where: { id },
    data,
    include: { position: true },
  });
}

export async function deleteNameMapping(userId: string, id: number) {
  const existing = await prisma.portfolioNameMapping.findFirst({
    where: { id, userId },
  });
  if (!existing) throw new Error('Name mapping not found');

  return prisma.portfolioNameMapping.delete({ where: { id } });
}
