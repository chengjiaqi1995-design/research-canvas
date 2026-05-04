import axios from 'axios';
import crypto from 'crypto';
import type { EodhdPricePoint } from './eodhdService';

const FMP_BASE_URL = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable';

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};

type RawFmpRow = Record<string, unknown>;

const cache = new Map<string, CacheEntry<unknown>>();

function getCache<T>(key: string): T | null {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (!hit || hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache<T>(key: string, data: T, ttlMs: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function apiKey(tokenOverride?: string): string {
  const token = cleanString(tokenOverride) || process.env.FMP_API_KEY || process.env.FMP_API_TOKEN;
  if (!token) {
    const err = new Error('FMP_API_KEY is not configured');
    (err as any).status = 500;
    throw err;
  }
  return token;
}

export function hasFmpApiKey(tokenOverride?: string): boolean {
  return Boolean(cleanString(tokenOverride) || process.env.FMP_API_KEY || process.env.FMP_API_TOKEN);
}

function tokenCacheScope(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function utcDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function fmpGet<T>(path: string, params: Record<string, unknown>, ttlMs = 0, tokenOverride?: string): Promise<T> {
  const token = apiKey(tokenOverride);
  const mergedParams = { ...params, apikey: token };
  const cacheKey = `${path}:${tokenCacheScope(token)}:${JSON.stringify({ ...mergedParams, apikey: '<token>' })}`;
  if (ttlMs > 0) {
    const cached = getCache<T>(cacheKey);
    if (cached) return cached;
  }

  try {
    const res = await axios.get<T>(`${FMP_BASE_URL}${path}`, {
      params: mergedParams,
      timeout: 30_000,
    });
    if (ttlMs > 0) setCache(cacheKey, res.data, ttlMs);
    return res.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const body = error.response?.data as any;
      const message = typeof body === 'string'
        ? body
        : body?.['Error Message'] || body?.message || error.message;
      const err = new Error(`FMP request failed: ${message}`);
      (err as any).status = error.response?.status || 502;
      throw err;
    }
    throw error;
  }
}

function pickNumber(raw: RawFmpRow, keys: string[]): number | undefined {
  for (const key of keys) {
    const n = cleanNumber(raw[key]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function pickString(raw: RawFmpRow, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractRows(raw: unknown): RawFmpRow[] {
  if (Array.isArray(raw)) return raw as RawFmpRow[];
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.historical)) return obj.historical as RawFmpRow[];
  if (Array.isArray(obj.data)) return obj.data as RawFmpRow[];
  if (Array.isArray(obj.results)) return obj.results as RawFmpRow[];
  return [];
}

function normalizePricePoint(raw: RawFmpRow): EodhdPricePoint | null {
  const date = pickString(raw, ['date']);
  if (!date) return null;

  const close = pickNumber(raw, ['close', 'price']);
  const adjustedClose = pickNumber(raw, ['adjClose', 'adj_close', 'adjustedClose', 'adjusted_close']) ?? close;
  if (close == null && adjustedClose == null) return null;

  return {
    date,
    open: pickNumber(raw, ['open']),
    high: pickNumber(raw, ['high']),
    low: pickNumber(raw, ['low']),
    close,
    adjustedClose,
    volume: pickNumber(raw, ['volume']),
  };
}

function movingAverage(points: EodhdPricePoint[], index: number, period: number): number | undefined {
  if (index + 1 < period) return undefined;
  const slice = points.slice(index + 1 - period, index + 1);
  const values = slice
    .map((point) => point.adjustedClose ?? point.close)
    .filter((value): value is number => value != null);
  if (values.length < period) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / period;
}

export async function getPriceHistory(symbol: string, days = 220, tokenOverride?: string): Promise<EodhdPricePoint[]> {
  const safeSymbol = symbol.trim().toUpperCase();
  const raw = await fmpGet<unknown>(
    '/historical-price-eod/full',
    {
      symbol: safeSymbol,
      from: utcDateDaysAgo(days),
    },
    6 * 60 * 60 * 1000,
    tokenOverride,
  );

  const points = extractRows(raw)
    .map(normalizePricePoint)
    .filter((point): point is EodhdPricePoint => Boolean(point))
    .sort((a, b) => a.date.localeCompare(b.date));

  return points.map((point, index) => ({
    ...point,
    ma5: movingAverage(points, index, 5),
    ma20: movingAverage(points, index, 20),
    ma25: movingAverage(points, index, 25),
    ma50: movingAverage(points, index, 50),
    ma100: movingAverage(points, index, 100),
  }));
}
