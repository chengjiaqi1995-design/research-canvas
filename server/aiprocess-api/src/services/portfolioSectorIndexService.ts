import prisma from '../utils/db';
import type { EodhdPricePoint } from './eodhdService';
import {
  getUsableMarketPriceHistory,
  analyzePriceHistory,
  type MarketDataTokens,
  type PositionInput,
  type PortfolioTechnicalAnalysisItem,
  type PortfolioTechnicalAnalysisResponse,
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
const SECTOR_WINDOWS = [5, 10, 30];

function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

interface SectorBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

// Adjusted-close-aligned OHLC for a single raw price point. Mirrors the
// normalization used by the technical engine so synthetic indices stay
// consistent with single-stock charts.
function adjustedBar(point: EodhdPricePoint): SectorBar | null {
  const close = point.adjustedClose ?? point.close;
  if (close == null || close <= 0) return null;
  const ratio = point.adjustedClose != null && point.close ? point.adjustedClose / point.close : 1;
  const open = point.open != null ? point.open * ratio : close;
  const high = Math.max(point.high != null ? point.high * ratio : close, open, close);
  const low = Math.min(point.low != null ? point.low * ratio : close, open, close);
  return { open, high, low, close };
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
  bars: Map<string, SectorBar>;
}

function sma(values: number[], period: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// Equal-weight, direction-aware candlestick index rebased to 100. Each
// constituent's intraday O/H/L/C is converted to a return off its own prior
// close; short positions are inverted (and their high/low swapped, since a
// short's best intraday level is the underlying's low). Returns are averaged
// equal-weight across constituents present on the day, then chained off the
// running index level so staggered listings and gaps don't break the series.
function buildSectorCandles(constituents: FetchedConstituent[]): EodhdPricePoint[] {
  const dateSet = new Set<string>();
  for (const c of constituents) {
    for (const date of c.bars.keys()) dateSet.add(date);
  }
  const dates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  if (dates.length === 0) return [];

  const prevClose = new Map<FetchedConstituent, number>();
  const candles: EodhdPricePoint[] = [];
  let level = 100;

  for (const date of dates) {
    let sumOpen = 0;
    let sumHigh = 0;
    let sumLow = 0;
    let sumClose = 0;
    let count = 0;
    for (const c of constituents) {
      const bar = c.bars.get(date);
      if (bar == null) continue;
      const prev = prevClose.get(c);
      if (prev != null && prev > 0) {
        const rO = bar.open / prev - 1;
        const rH = bar.high / prev - 1;
        const rL = bar.low / prev - 1;
        const rC = bar.close / prev - 1;
        if (c.position.longShort === 'short') {
          sumOpen += -rO;
          sumHigh += -rL;
          sumLow += -rH;
          sumClose += -rC;
        } else {
          sumOpen += rO;
          sumHigh += rH;
          sumLow += rL;
          sumClose += rC;
        }
        count += 1;
      }
      prevClose.set(c, bar.close);
    }

    const prevLevel = level;
    if (count > 0) {
      level = prevLevel * (1 + sumClose / count);
      const open = prevLevel * (1 + sumOpen / count);
      const close = level;
      const high = Math.max(prevLevel * (1 + sumHigh / count), open, close);
      const low = Math.min(prevLevel * (1 + sumLow / count), open, close);
      candles.push({ date, open, high, low, close });
    } else {
      candles.push({ date, open: level, high: level, low: level, close: level });
    }
  }

  const closes = candles.map((c) => c.close ?? 100);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma25 = sma(closes, 25);
  const ma50 = sma(closes, 50);
  const ma100 = sma(closes, 100);
  return candles.map((candle, index) => ({
    ...candle,
    ma10: ma10[index],
    ma20: ma20[index],
    ma25: ma25[index],
    ma50: ma50[index],
    ma100: ma100[index],
  }));
}

function buildSectorIndex(constituents: FetchedConstituent[]): SectorIndexPoint[] {
  const candles = buildSectorCandles(constituents);
  const points: SectorIndexPoint[] = candles.map((candle) => ({ date: candle.date, value: candle.close ?? 100 }));
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

function resolveScopeWhere(userId: string, scope: string): any {
  const where: any = { userId };
  if (scope === 'active') where.longShort = { in: ['long', 'short'] };
  else if (scope === 'watchlist') where.longShort = '/';
  return where;
}

async function fetchSectorConstituents(
  userId: string,
  scope: string,
  days: number,
  tokens?: MarketDataTokens,
): Promise<{ usable: FetchedConstituent[]; totalCount: number }> {
  const positions = await prisma.portfolioPosition.findMany({
    where: resolveScopeWhere(userId, scope),
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
      const bars = new Map<string, SectorBar>();
      for (const point of history) {
        const bar = adjustedBar(point);
        if (bar != null) bars.set(point.date, bar);
      }
      if (bars.size < 8) return null;
      return {
        position: input,
        sectorName: (position.sectorName || '').trim() || '其他',
        bars,
      } satisfies FetchedConstituent;
    } catch {
      return null;
    }
  });

  const usable = fetched.filter((item): item is FetchedConstituent => item != null);
  return { usable, totalCount: positions.length };
}

function groupBySector(usable: FetchedConstituent[]): Map<string, FetchedConstituent[]> {
  const bySector = new Map<string, FetchedConstituent[]>();
  for (const item of usable) {
    const list = bySector.get(item.sectorName) || [];
    list.push(item);
    bySector.set(item.sectorName, list);
  }
  return bySector;
}

export async function computeSectorIndices(
  userId: string,
  params?: { scope?: string; days?: string | number },
  tokens?: MarketDataTokens,
): Promise<SectorIndexResponse> {
  const scope = params?.scope || 'all';
  const days = Math.min(Math.max(cleanNumber(params?.days) || DEFAULT_HISTORY_DAYS, MIN_HISTORY_DAYS), MAX_HISTORY_DAYS);

  const { usable, totalCount } = await fetchSectorConstituents(userId, scope, days, tokens);
  const bySector = groupBySector(usable);

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
    skippedCount: totalCount - usable.length,
    sectors,
  };
}

// Runs the full single-stock technical engine on each sector's synthetic
// candlestick index, returning items shaped like positions so the frontend can
// reuse the same detail module. Sectors get synthetic negative position ids.
export async function computeSectorTechnicals(
  userId: string,
  params?: { scope?: string; days?: string | number },
  tokens?: MarketDataTokens,
): Promise<PortfolioTechnicalAnalysisResponse> {
  const scope = params?.scope || 'all';
  const days = Math.min(Math.max(cleanNumber(params?.days) || DEFAULT_HISTORY_DAYS, MIN_HISTORY_DAYS), MAX_HISTORY_DAYS);

  const { usable } = await fetchSectorConstituents(userId, scope, days, tokens);
  const bySector = groupBySector(usable);

  const entries = Array.from(bySector.entries())
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const items: PortfolioTechnicalAnalysisItem[] = [];
  let syntheticId = -1;
  for (const [sectorName, members] of entries) {
    const candles = buildSectorCandles(members);
    const positionAmount = members.reduce((sum, m) => sum + (m.position.positionAmount || 0), 0);
    const positionWeight = members.reduce((sum, m) => sum + (m.position.positionWeight || 0), 0);
    const base = {
      positionId: syntheticId--,
      tickerBbg: sectorName,
      eodhdSymbol: null,
      marketDataSymbol: `${members.length} 只成分 · 等权·方向`,
      nameEn: sectorName,
      nameCn: sectorName,
      longShort: 'long',
      positionAmount,
      positionWeight,
    };

    if (candles.length < 20) {
      items.push({ ...base, windows: [], history: [], error: '成分股价历史不足，无法生成板块指数。' });
      continue;
    }

    const analysis = analyzePriceHistory(candles, SECTOR_WINDOWS, candles.length);
    items.push({ ...base, ...analysis });
  }

  return {
    generatedAt: new Date().toISOString(),
    scope,
    windows: SECTOR_WINDOWS,
    analyzedCount: items.filter((item) => !item.error).length,
    skippedCount: items.filter((item) => item.error).length,
    items,
  };
}
