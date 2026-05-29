import prisma from '../utils/db';
import type { EodhdPricePoint } from './eodhdService';
import {
  getUsableMarketPriceHistory,
  type MarketDataTokens,
  type PositionInput,
} from './portfolioTechnicalService';

export interface SectorIndexPoint {
  date: string;
  value: number;
}

export interface SectorIndexConstituent {
  positionId: number;
  tickerBbg: string;
  nameEn: string;
  nameCn: string;
  longShort: string;
  points: SectorIndexPoint[];
  latestValue?: number;
  periodReturnPct?: number;
}

export interface SectorIndexSeries {
  sectorName: string;
  constituentCount: number;
  constituents: SectorIndexConstituent[];
  points: SectorIndexPoint[];
  startDate?: string;
  endDate?: string;
  latestValue?: number;
  periodReturnPct?: number;
  periodHigh?: number;
  periodLow?: number;
}

export interface SectorIndexResponse {
  generatedAt: string;
  scope: string;
  days: number;
  longShortMode: 'directed';
  analyzedCount: number;
  skippedCount: number;
  sectors: SectorIndexSeries[];
}

const DEFAULT_HISTORY_DAYS = 1095;
const MIN_HISTORY_DAYS = 180;
const MAX_HISTORY_DAYS = 10000;
const MAX_INDEX_POINTS = 1500;
const FETCH_CONCURRENCY = 5;

function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function closeOf(point: EodhdPricePoint): number | undefined {
  return point.adjustedClose ?? point.close;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

interface FetchedConstituent {
  position: PositionInput;
  sectorName: string;
  closes: Map<string, number>;
}

// Equal-weight, direction-aware index rebased to 100. Short positions contribute
// the inverse of their daily return so the series reflects the sector's net P&L
// direction rather than raw price. Returns are chained per constituent across its
// own available dates, so staggered listings and data gaps don't break the index.
function buildSectorIndex(constituents: FetchedConstituent[]): SectorIndexPoint[] {
  const dateSet = new Set<string>();
  for (const c of constituents) {
    for (const date of c.closes.keys()) dateSet.add(date);
  }
  const dates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  if (dates.length === 0) return [];

  const prevClose = new Map<FetchedConstituent, number>();
  const points: SectorIndexPoint[] = [];
  let level = 100;

  for (const date of dates) {
    let sumReturn = 0;
    let count = 0;
    for (const c of constituents) {
      const close = c.closes.get(date);
      if (close == null) continue;
      const prev = prevClose.get(c);
      if (prev != null && prev > 0) {
        const raw = close / prev - 1;
        const directed = c.position.longShort === 'short' ? -raw : raw;
        sumReturn += directed;
        count += 1;
      }
      prevClose.set(c, close);
    }
    if (count > 0) level *= 1 + sumReturn / count;
    points.push({ date, value: level });
  }

  return downsample(points, MAX_INDEX_POINTS);
}

function downsample(points: SectorIndexPoint[], maxPoints: number): SectorIndexPoint[] {
  if (points.length <= maxPoints) return points;
  const stride = Math.ceil(points.length / maxPoints);
  const out: SectorIndexPoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1]?.date !== last.date) out.push(last);
  return out;
}

export async function computeSectorIndices(
  userId: string,
  params?: { scope?: string; days?: string | number },
  tokens?: MarketDataTokens,
): Promise<SectorIndexResponse> {
  const scope = params?.scope || 'all';
  const days = Math.min(Math.max(cleanNumber(params?.days) || DEFAULT_HISTORY_DAYS, MIN_HISTORY_DAYS), MAX_HISTORY_DAYS);

  const where: any = { userId };
  if (scope === 'active') where.longShort = { in: ['long', 'short'] };
  else if (scope === 'watchlist') where.longShort = '/';

  const positions = await prisma.portfolioPosition.findMany({
    where,
    select: {
      id: true,
      tickerBbg: true,
      nameEn: true,
      nameCn: true,
      market: true,
      longShort: true,
      positionAmount: true,
      positionWeight: true,
      sectorName: true,
    },
    orderBy: { positionAmount: 'desc' },
  });

  const fetched = await mapWithConcurrency(positions, FETCH_CONCURRENCY, async (position) => {
    const input: PositionInput = {
      id: position.id,
      tickerBbg: position.tickerBbg,
      nameEn: position.nameEn,
      nameCn: position.nameCn,
      market: position.market,
      longShort: position.longShort,
      positionAmount: position.positionAmount,
      positionWeight: position.positionWeight,
    };
    try {
      const { history } = await getUsableMarketPriceHistory(input, days, tokens);
      const closes = new Map<string, number>();
      for (const point of history) {
        const close = closeOf(point);
        if (close != null && close > 0) closes.set(point.date, close);
      }
      if (closes.size < 8) return null;
      return {
        position: input,
        sectorName: (position.sectorName || '').trim() || '其他',
        closes,
      } satisfies FetchedConstituent;
    } catch {
      return null;
    }
  });

  const usable = fetched.filter((item): item is FetchedConstituent => item != null);

  const bySector = new Map<string, FetchedConstituent[]>();
  for (const item of usable) {
    const list = bySector.get(item.sectorName) || [];
    list.push(item);
    bySector.set(item.sectorName, list);
  }

  const sectors: SectorIndexSeries[] = [];
  for (const [sectorName, members] of bySector) {
    const points = buildSectorIndex(members);
    if (points.length < 2) continue;
    const values = points.map((p) => p.value);
    const latestValue = values[values.length - 1];
    sectors.push({
      sectorName,
      constituentCount: members.length,
      constituents: members.map((m) => {
        const memberPoints = buildSectorIndex([m]);
        const memberLatest = memberPoints.length ? memberPoints[memberPoints.length - 1].value : undefined;
        return {
          positionId: m.position.id,
          tickerBbg: m.position.tickerBbg,
          nameEn: m.position.nameEn,
          nameCn: m.position.nameCn,
          longShort: m.position.longShort,
          points: memberPoints,
          latestValue: memberLatest,
          periodReturnPct: memberLatest != null ? memberLatest - 100 : undefined,
        };
      }),
      points,
      startDate: points[0].date,
      endDate: points[points.length - 1].date,
      latestValue,
      periodReturnPct: latestValue - 100,
      periodHigh: Math.max(...values),
      periodLow: Math.min(...values),
    });
  }

  sectors.sort((a, b) => b.constituentCount - a.constituentCount || a.sectorName.localeCompare(b.sectorName));

  return {
    generatedAt: new Date().toISOString(),
    scope,
    days,
    longShortMode: 'directed',
    analyzedCount: usable.length,
    skippedCount: positions.length - usable.length,
    sectors,
  };
}
