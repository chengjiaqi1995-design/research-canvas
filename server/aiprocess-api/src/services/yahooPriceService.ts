import YahooFinance from 'yahoo-finance2';
import type { EodhdPricePoint } from './eodhdService';
import { bbgToYahooSymbolCandidates } from './yahooSymbolMapper';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

function utcDateDaysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function cleanDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.trim()) return value.slice(0, 10);
  return '';
}

function normalizeQuote(raw: Record<string, unknown>): EodhdPricePoint | null {
  const date = cleanDate(raw.date);
  if (!date) return null;
  const close = cleanNumber(raw.close);
  const adjustedClose = cleanNumber(raw.adjclose) ?? cleanNumber(raw.adjClose) ?? close;
  if (close == null && adjustedClose == null) return null;
  return {
    date,
    open: cleanNumber(raw.open),
    high: cleanNumber(raw.high),
    low: cleanNumber(raw.low),
    close,
    adjustedClose,
    volume: cleanNumber(raw.volume),
  };
}

export async function getYahooPriceHistoryForBbg(
  tickerBbg: string,
  market: string | undefined,
  days: number,
): Promise<{ provider: 'yahoo'; symbol: string; history: EodhdPricePoint[] }> {
  const candidates = bbgToYahooSymbolCandidates(tickerBbg, market);
  let lastError: unknown;

  for (const symbol of candidates) {
    try {
      const result = await (yahooFinance as any).chart(
        symbol,
        {
          period1: utcDateDaysAgo(days),
          period2: new Date(),
          interval: '1d',
        },
        { validateResult: false },
      );
      const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
      const history = quotes
        .map((row: Record<string, unknown>) => normalizeQuote(row))
        .filter((point: EodhdPricePoint | null): point is EodhdPricePoint => Boolean(point))
        .sort((a: EodhdPricePoint, b: EodhdPricePoint) => a.date.localeCompare(b.date));
      if (history.length >= 2) return { provider: 'yahoo', symbol, history };
      lastError = new Error(`Yahoo 价格历史不足；symbol=${symbol}；返回 ${history.length} 条`);
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError || 'Yahoo 价格历史不足');
  throw new Error(`${message}${candidates.length ? `；已尝试 ${candidates.join(', ')}` : ''}`);
}
