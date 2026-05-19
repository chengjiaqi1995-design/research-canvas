import prisma from '../utils/db';
import type { EodhdPricePoint } from './eodhdService';
import {
  getUsableMarketPriceHistory,
  type MarketDataTokens,
  type PositionInput,
} from './portfolioTechnicalService';
import { getYahooPriceHistoryForBbg } from './yahooPriceService';

type PriceUpdateScope = 'active' | 'watchlist' | 'all';

export interface PortfolioPriceUpdateFailure {
  positionId: number;
  tickerBbg: string;
  nameEn: string;
  error: string;
}

export interface PortfolioPriceUpdateItem {
  positionId: number;
  tickerBbg: string;
  nameEn: string;
  provider: string;
  symbol: string;
  latestDate?: string;
  return1d: number | null;
  return1m: number | null;
  return1y: number | null;
}

export interface PortfolioPriceUpdateResult {
  generatedAt: string;
  scope: PriceUpdateScope;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
  items: PortfolioPriceUpdateItem[];
  failures: PortfolioPriceUpdateFailure[];
}

function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseScope(value: unknown): PriceUpdateScope {
  return value === 'watchlist' || value === 'all' ? value : 'active';
}

function closeOf(point: EodhdPricePoint | undefined): number | undefined {
  return point?.adjustedClose ?? point?.close;
}

function returnForLookback(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const latest = closes[closes.length - 1];
  const previous = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) return null;
  return latest / previous - 1;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '价格更新失败');
}

export async function updatePortfolioPrices(
  userId: string,
  params?: { scope?: unknown; limit?: unknown },
  tokens?: MarketDataTokens,
): Promise<PortfolioPriceUpdateResult> {
  const scope = parseScope(params?.scope);
  const limit = Math.min(Math.max(cleanNumber(params?.limit) || 300, 1), 500);
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
    },
    take: limit,
  });
  positions.sort((a, b) => Math.abs(b.positionAmount) - Math.abs(a.positionAmount));

  const now = new Date();
  const items: PortfolioPriceUpdateItem[] = [];
  const failures: PortfolioPriceUpdateFailure[] = [];

  await mapWithConcurrency(positions, 5, async (position: PositionInput) => {
    try {
      let provider: string;
      let symbol: string;
      let history: EodhdPricePoint[];
      try {
        const primary = await getUsableMarketPriceHistory(position, 460, tokens);
        provider = primary.provider;
        symbol = primary.symbol;
        history = primary.history;
      } catch (primaryError) {
        try {
          const yahoo = await getYahooPriceHistoryForBbg(position.tickerBbg, position.market, 460);
          provider = yahoo.provider;
          symbol = yahoo.symbol;
          history = yahoo.history;
        } catch (yahooError) {
          throw new Error(`${errorMessage(primaryError)}；Yahoo: ${errorMessage(yahooError)}`);
        }
      }
      const closes = history
        .map(closeOf)
        .filter((value): value is number => value != null && Number.isFinite(value));
      if (closes.length < 2) throw new Error(`价格历史不足；symbol=${symbol}；返回 ${history.length} 条`);

      const return1d = returnForLookback(closes, 1);
      const return1m = returnForLookback(closes, 21);
      const return1y = returnForLookback(closes, 252);

      await prisma.portfolioPosition.update({
        where: { id: position.id },
        data: {
          return1d,
          return1m,
          return1y,
          pricesUpdatedAt: now,
        },
      });

      items.push({
        positionId: position.id,
        tickerBbg: position.tickerBbg,
        nameEn: position.nameEn,
        provider,
        symbol,
        latestDate: history[history.length - 1]?.date,
        return1d,
        return1m,
        return1y,
      });
    } catch (error) {
      failures.push({
        positionId: position.id,
        tickerBbg: position.tickerBbg,
        nameEn: position.nameEn,
        error: errorMessage(error),
      });
    }
  });

  return {
    generatedAt: now.toISOString(),
    scope,
    total: positions.length,
    updated: items.length,
    skipped: 0,
    failed: failures.length,
    items,
    failures: failures.slice(0, 50),
  };
}
