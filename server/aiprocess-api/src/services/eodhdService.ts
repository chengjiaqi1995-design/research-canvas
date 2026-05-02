import axios from 'axios';
import prisma from '../utils/db';

const EODHD_BASE_URL = process.env.EODHD_BASE_URL || 'https://eodhd.com/api';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};

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

function apiToken(): string {
  const token = process.env.EODHD_API_TOKEN || process.env.EODHD_API_KEY;
  if (!token) {
    const err = new Error('EODHD_API_TOKEN is not configured');
    (err as any).status = 500;
    throw err;
  }
  return token;
}

function clampLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function utcDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export interface EodhdExchange {
  code: string;
  name: string;
  country?: string;
  countryIso2?: string;
  countryIso3?: string;
  currency?: string;
  operatingMic?: string;
}

export interface EodhdScreenerFilters {
  country?: string;
  exchange?: string;
  query?: string;
  sector?: string;
  industry?: string;
  marketCapMin?: number;
  marketCapMax?: number;
  priceMin?: number;
  priceMax?: number;
  return1dMin?: number;
  return1dMax?: number;
  return5dMin?: number;
  return5dMax?: number;
  volumeMin?: number;
  volumeMax?: number;
  avgVol200dMin?: number;
  avgVol200dMax?: number;
  priceVsMa5?: 'any' | 'above' | 'below';
  ma5DistanceMin?: number;
  ma5DistanceMax?: number;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface EodhdScreenerRow {
  symbol: string;
  code: string;
  exchange: string;
  name: string;
  country?: string;
  currency?: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  close?: number;
  return1dPct?: number;
  return5dPct?: number;
  volume1d?: number;
  avgVol200d?: number;
  ma5?: number;
  ma5Date?: string;
  priceVsMa5Pct?: number;
  inPortfolio?: boolean;
  portfolioPositionId?: number;
  portfolioLongShort?: string;
}

export interface EodhdPricePoint {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  adjustedClose?: number;
  volume?: number;
  ma5?: number;
  ma20?: number;
  ma50?: number;
}

export interface EodhdScreenerResponse {
  items: EodhdScreenerRow[];
  total: number;
  limit: number;
  offset: number;
  meta: {
    generatedAt: string;
    exchanges: string[];
    rawCount: number;
    ma5Filtered: boolean;
    warnings: string[];
  };
}

type RawEodhdRow = Record<string, unknown>;
type RawExchangeSymbol = {
  Code?: string;
  Name?: string;
  Country?: string;
  Exchange?: string;
  Currency?: string;
  Type?: string;
};

const US_MAJOR_VENUES = new Set(['NYSE', 'NASDAQ', 'NYSE MKT', 'NYSE ARCA', 'BATS']);

async function eodhdGet<T>(path: string, params: Record<string, unknown>, ttlMs = 0): Promise<T> {
  const mergedParams = { ...params, api_token: apiToken(), fmt: 'json' };
  const cacheKey = `${path}:${JSON.stringify({ ...mergedParams, api_token: '<token>' })}`;
  if (ttlMs > 0) {
    const cached = getCache<T>(cacheKey);
    if (cached) return cached;
  }

  try {
    const res = await axios.get<T>(`${EODHD_BASE_URL}${path}`, {
      params: mergedParams,
      timeout: 30_000,
    });
    if (ttlMs > 0) setCache(cacheKey, res.data, ttlMs);
    return res.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = typeof error.response?.data === 'string'
        ? error.response.data
        : (error.response?.data as any)?.message || error.message;
      const err = new Error(`EODHD request failed: ${message}`);
      (err as any).status = error.response?.status || 502;
      throw err;
    }
    throw error;
  }
}

function pickNumber(raw: RawEodhdRow, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = raw[key];
    const n = cleanNumber(value);
    if (n !== undefined) return n;
  }
  return undefined;
}

function pickString(raw: RawEodhdRow, keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeExchange(raw: RawEodhdRow): EodhdExchange | null {
  const code = pickString(raw, ['Code', 'code']);
  if (!code) return null;
  return {
    code,
    name: pickString(raw, ['Name', 'name']) || code,
    country: pickString(raw, ['Country', 'country']),
    countryIso2: pickString(raw, ['CountryISO2', 'country_iso2', 'countryIso2']),
    countryIso3: pickString(raw, ['CountryISO3', 'country_iso3', 'countryIso3']),
    currency: pickString(raw, ['Currency', 'currency']),
    operatingMic: pickString(raw, ['OperatingMIC', 'operating_mic', 'operatingMic']),
  };
}

export async function listExchanges(): Promise<EodhdExchange[]> {
  const raw = await eodhdGet<RawEodhdRow[]>('/exchanges-list/', {}, 7 * 24 * 60 * 60 * 1000);
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeExchange)
    .filter((item): item is EodhdExchange => Boolean(item));
}

function matchesCountry(exchange: EodhdExchange, country: string): boolean {
  const q = country.toLowerCase();
  return [exchange.country, exchange.countryIso2, exchange.countryIso3]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase() === q);
}

function preferredExchangeRank(code: string): number {
  const order = ['US', 'HK', 'SHG', 'SHE', 'TSE', 'LSE', 'TO', 'PA', 'XETRA', 'SW'];
  const index = order.indexOf(code.toUpperCase());
  return index === -1 ? 999 : index;
}

async function resolveExchangeCodes(filters: EodhdScreenerFilters): Promise<string[]> {
  const requestedExchange = cleanString(filters.exchange);
  if (requestedExchange && requestedExchange !== 'all') return [requestedExchange.toUpperCase()];

  const country = cleanString(filters.country);
  if (!country || country === 'all') return ['US'];

  const exchanges = await listExchanges();
  const matched = exchanges
    .filter((exchange) => matchesCountry(exchange, country))
    .map((exchange) => exchange.code.toUpperCase())
    .filter(Boolean);

  const unique = Array.from(new Set(matched));
  unique.sort((a, b) => preferredExchangeRank(a) - preferredExchangeRank(b) || a.localeCompare(b));
  return unique.slice(0, 6);
}

function addRangeFilter(
  filters: unknown[][],
  field: string,
  minValue?: number,
  maxValue?: number,
) {
  if (minValue !== undefined) filters.push([field, '>=', minValue]);
  if (maxValue !== undefined) filters.push([field, '<=', maxValue]);
}

function wildcard(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.includes('*')) return trimmed;
  return `*${trimmed}*`;
}

function buildScreenerFilters(filters: EodhdScreenerFilters, exchangeCode: string): unknown[][] {
  const eodFilters: unknown[][] = [['exchange', '=', exchangeCode.toLowerCase()]];
  const query = cleanString(filters.query);
  const sector = cleanString(filters.sector);
  const industry = cleanString(filters.industry);

  if (query) {
    const isCodeLike = /^[A-Za-z0-9.-]{1,12}$/.test(query);
    eodFilters.push([isCodeLike ? 'code' : 'name', 'match', wildcard(query)]);
  }
  if (sector) eodFilters.push(['sector', 'match', wildcard(sector)]);
  if (industry) eodFilters.push(['industry', 'match', wildcard(industry)]);

  addRangeFilter(eodFilters, 'market_capitalization', cleanNumber(filters.marketCapMin), cleanNumber(filters.marketCapMax));
  addRangeFilter(eodFilters, 'adjusted_close', cleanNumber(filters.priceMin), cleanNumber(filters.priceMax));
  addRangeFilter(eodFilters, 'refund_1d_p', cleanNumber(filters.return1dMin), cleanNumber(filters.return1dMax));
  addRangeFilter(eodFilters, 'refund_5d_p', cleanNumber(filters.return5dMin), cleanNumber(filters.return5dMax));
  addRangeFilter(eodFilters, 'avgvol_1d', cleanNumber(filters.volumeMin), cleanNumber(filters.volumeMax));
  addRangeFilter(eodFilters, 'avgvol_200d', cleanNumber(filters.avgVol200dMin), cleanNumber(filters.avgVol200dMax));

  return eodFilters;
}

function normalizeScreenerResponse(raw: unknown): RawEodhdRow[] {
  if (Array.isArray(raw)) return raw as RawEodhdRow[];
  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    if (Array.isArray(object.data)) return object.data as RawEodhdRow[];
    if (Array.isArray(object.items)) return object.items as RawEodhdRow[];
  }
  return [];
}

function normalizeScreenerRow(raw: RawEodhdRow, exchangeCode: string): EodhdScreenerRow | null {
  const code = pickString(raw, ['code', 'Code']);
  const exchange = (pickString(raw, ['exchange', 'Exchange']) || exchangeCode).toUpperCase();
  if (!code) return null;

  const close = pickNumber(raw, ['adjusted_close', 'close', 'Close']);
  return {
    symbol: `${code}.${exchange}`,
    code,
    exchange,
    name: pickString(raw, ['name', 'Name']) || code,
    country: pickString(raw, ['country_name', 'country', 'Country']),
    currency: pickString(raw, ['currency_symbol', 'currency', 'Currency']),
    sector: pickString(raw, ['sector', 'Sector']),
    industry: pickString(raw, ['industry', 'Industry']),
    marketCap: pickNumber(raw, ['market_capitalization', 'market_cap', 'MarketCapitalization']),
    close,
    return1dPct: pickNumber(raw, ['refund_1d_p', 'return_1d_p']),
    return5dPct: pickNumber(raw, ['refund_5d_p', 'return_5d_p']),
    volume1d: pickNumber(raw, ['avgvol_1d', 'volume', 'Volume']),
    avgVol200d: pickNumber(raw, ['avgvol_200d']),
  };
}

async function fetchScreenerForExchange(
  filters: EodhdScreenerFilters,
  exchangeCode: string,
  limit: number,
): Promise<EodhdScreenerRow[]> {
  const eodFilters = buildScreenerFilters(filters, exchangeCode);
  const raw = await eodhdGet<unknown>(
    '/screener',
    {
      filters: JSON.stringify(eodFilters),
      limit,
      offset: 0,
      sort: filters.sort || 'market_capitalization.desc',
    },
    15 * 60 * 1000,
  );
  return normalizeScreenerResponse(raw)
    .map((row) => normalizeScreenerRow(row, exchangeCode))
    .filter((row): row is EodhdScreenerRow => Boolean(row));
}

function isEodOnlyPermissionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Only EOD data allowed');
}

async function fetchExchangeSymbols(exchangeCode: string): Promise<RawExchangeSymbol[]> {
  const safeExchange = encodeURIComponent(exchangeCode.toUpperCase());
  const raw = await eodhdGet<RawExchangeSymbol[]>(
    `/exchange-symbol-list/${safeExchange}`,
    {},
    7 * 24 * 60 * 60 * 1000,
  );
  return Array.isArray(raw) ? raw : [];
}

function normalizeExchangeSymbol(raw: RawExchangeSymbol, exchangeCode: string): EodhdScreenerRow | null {
  const code = cleanString(raw.Code);
  if (!code || code.startsWith('^')) return null;
  const type = cleanString(raw.Type).toLowerCase();
  if (type && type !== 'common stock') return null;
  const venue = cleanString(raw.Exchange).toUpperCase();
  if (exchangeCode.toUpperCase() === 'US' && venue && !US_MAJOR_VENUES.has(venue)) return null;

  return {
    symbol: `${code}.${exchangeCode.toUpperCase()}`,
    code,
    exchange: exchangeCode.toUpperCase(),
    name: cleanString(raw.Name) || code,
    country: cleanString(raw.Country),
    currency: cleanString(raw.Currency),
  };
}

function applyBasicFallbackFilters(rows: EodhdScreenerRow[], filters: EodhdScreenerFilters): EodhdScreenerRow[] {
  const query = cleanString(filters.query).toLowerCase();
  let result = rows;

  if (query) {
    result = result.filter((row) =>
      row.code.toLowerCase().includes(query) || row.name.toLowerCase().includes(query),
    );
  }

  return result;
}

function applyEodDerivedFilters(rows: EodhdScreenerRow[], filters: EodhdScreenerFilters): EodhdScreenerRow[] {
  const priceMin = cleanNumber(filters.priceMin);
  const priceMax = cleanNumber(filters.priceMax);
  const return1dMin = cleanNumber(filters.return1dMin);
  const return1dMax = cleanNumber(filters.return1dMax);
  const return5dMin = cleanNumber(filters.return5dMin);
  const return5dMax = cleanNumber(filters.return5dMax);
  const volumeMin = cleanNumber(filters.volumeMin);
  const volumeMax = cleanNumber(filters.volumeMax);

  return rows.filter((row) => {
    if (priceMin !== undefined && (row.close == null || row.close < priceMin)) return false;
    if (priceMax !== undefined && (row.close == null || row.close > priceMax)) return false;
    if (return1dMin !== undefined && (row.return1dPct == null || row.return1dPct < return1dMin)) return false;
    if (return1dMax !== undefined && (row.return1dPct == null || row.return1dPct > return1dMax)) return false;
    if (return5dMin !== undefined && (row.return5dPct == null || row.return5dPct < return5dMin)) return false;
    if (return5dMax !== undefined && (row.return5dPct == null || row.return5dPct > return5dMax)) return false;
    if (volumeMin !== undefined && (row.volume1d == null || row.volume1d < volumeMin)) return false;
    if (volumeMax !== undefined && (row.volume1d == null || row.volume1d > volumeMax)) return false;
    return true;
  });
}

function calcReturnPct(history: EodhdPricePoint[], currentIndex: number, lookback: number): number | undefined {
  const current = history[currentIndex]?.adjustedClose ?? history[currentIndex]?.close;
  const previous = history[currentIndex - lookback]?.adjustedClose ?? history[currentIndex - lookback]?.close;
  if (current == null || previous == null || previous === 0) return undefined;
  return (current / previous - 1) * 100;
}

async function annotateEodOnlyRow(row: EodhdScreenerRow): Promise<EodhdScreenerRow | null> {
  try {
    const history = await getPriceHistory(row.symbol, 35);
    const latestIndex = history.length - 1;
    const latest = history[latestIndex];
    if (!latest) return null;
    const close = latest.adjustedClose ?? latest.close;
    const ma5 = latest.ma5;
    return {
      ...row,
      close,
      ma5,
      ma5Date: latest.date,
      volume1d: latest.volume,
      return1dPct: calcReturnPct(history, latestIndex, 1),
      return5dPct: calcReturnPct(history, latestIndex, 5),
      priceVsMa5Pct: close != null && ma5 != null && ma5 !== 0 ? (close / ma5 - 1) * 100 : undefined,
    };
  } catch {
    return null;
  }
}

function hasScreenerOnlyFilters(filters: EodhdScreenerFilters): boolean {
  return Boolean(
    cleanString(filters.sector)
      || cleanString(filters.industry)
      || cleanNumber(filters.marketCapMin) !== undefined
      || cleanNumber(filters.marketCapMax) !== undefined
      || cleanNumber(filters.avgVol200dMin) !== undefined
      || cleanNumber(filters.avgVol200dMax) !== undefined,
  );
}

async function fetchEodOnlyForExchange(
  filters: EodhdScreenerFilters,
  exchangeCode: string,
  limit: number,
): Promise<EodhdScreenerRow[]> {
  const symbols = await fetchExchangeSymbols(exchangeCode);
  const normalized = symbols
    .map((row) => normalizeExchangeSymbol(row, exchangeCode))
    .filter((row): row is EodhdScreenerRow => Boolean(row));

  const candidates = applyBasicFallbackFilters(normalized, filters).slice(0, Math.min(80, Math.max(limit * 3, limit)));
  const annotated = await mapWithConcurrency(candidates, 6, annotateEodOnlyRow);
  let rows = annotated.filter((row): row is EodhdScreenerRow => Boolean(row));
  rows = applyEodDerivedFilters(rows, filters);
  if (needsMa5(filters)) rows = filterByMa5(rows, filters);
  return rows;
}

type RawEodPoint = {
  date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  adjusted_close?: number | string;
  volume?: number | string;
};

function normalizePricePoint(raw: RawEodPoint): EodhdPricePoint | null {
  if (!raw.date) return null;
  return {
    date: raw.date,
    open: cleanNumber(raw.open),
    high: cleanNumber(raw.high),
    low: cleanNumber(raw.low),
    close: cleanNumber(raw.close),
    adjustedClose: cleanNumber(raw.adjusted_close),
    volume: cleanNumber(raw.volume),
  };
}

function movingAverage(points: EodhdPricePoint[], index: number, period: number): number | undefined {
  if (index + 1 < period) return undefined;
  const slice = points.slice(index + 1 - period, index + 1);
  const values = slice.map((point) => point.adjustedClose ?? point.close).filter((value): value is number => value !== undefined);
  if (values.length < period) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / period;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function getPriceHistory(symbol: string, days = 220): Promise<EodhdPricePoint[]> {
  const safeSymbol = encodeURIComponent(symbol.trim().toUpperCase());
  const raw = await eodhdGet<RawEodPoint[]>(
    `/eod/${safeSymbol}`,
    {
      period: 'd',
      from: utcDateDaysAgo(days),
      order: 'a',
    },
    6 * 60 * 60 * 1000,
  );

  const points = (Array.isArray(raw) ? raw : [])
    .map(normalizePricePoint)
    .filter((point): point is EodhdPricePoint => Boolean(point))
    .sort((a, b) => a.date.localeCompare(b.date));

  return points.map((point, index) => ({
    ...point,
    ma5: movingAverage(points, index, 5),
    ma20: movingAverage(points, index, 20),
    ma50: movingAverage(points, index, 50),
  }));
}

async function annotateMa5(rows: EodhdScreenerRow[]): Promise<EodhdScreenerRow[]> {
  return mapWithConcurrency(rows, 6, async (row) => {
    try {
      const history = await getPriceHistory(row.symbol, 35);
      const last = history[history.length - 1];
      const ma5 = last?.ma5;
      const close = row.close ?? last?.adjustedClose ?? last?.close;
      if (ma5 === undefined || close === undefined || ma5 === 0) return row;
      return {
        ...row,
        close,
        ma5,
        ma5Date: last?.date,
        priceVsMa5Pct: (close / ma5 - 1) * 100,
      };
    } catch {
      return row;
    }
  });
}

function needsMa5(filters: EodhdScreenerFilters): boolean {
  return filters.priceVsMa5 === 'above'
    || filters.priceVsMa5 === 'below'
    || filters.ma5DistanceMin !== undefined
    || filters.ma5DistanceMax !== undefined;
}

function filterByMa5(rows: EodhdScreenerRow[], filters: EodhdScreenerFilters): EodhdScreenerRow[] {
  const direction = filters.priceVsMa5 || 'any';
  const minDistance = cleanNumber(filters.ma5DistanceMin);
  const maxDistance = cleanNumber(filters.ma5DistanceMax);

  return rows.filter((row) => {
    if (row.ma5 === undefined || row.close === undefined || row.priceVsMa5Pct === undefined) return false;
    if (direction === 'above' && row.close <= row.ma5) return false;
    if (direction === 'below' && row.close >= row.ma5) return false;
    if (minDistance !== undefined && row.priceVsMa5Pct < minDistance) return false;
    if (maxDistance !== undefined && row.priceVsMa5Pct > maxDistance) return false;
    return true;
  });
}

type PortfolioSymbol = {
  id: number;
  code: string;
  market: string;
  longShort: string;
};

function parsePortfolioTicker(tickerBbg: string): PortfolioSymbol | null {
  const parts = tickerBbg.replace(/\s+Equity$/i, '').trim().split(/\s+/);
  const code = parts[0]?.toUpperCase();
  if (!code) return null;
  return {
    id: 0,
    code,
    market: (parts[1] || '').toUpperCase(),
    longShort: '',
  };
}

const MARKET_ALIASES: Record<string, string[]> = {
  US: ['US', 'NYSE', 'NASDAQ', 'NYSE MKT'],
  HK: ['HK'],
  CH: ['SHG', 'SHE', 'SS', 'SZ', 'SSE', 'SZSE'],
  JP: ['TSE'],
  LN: ['LSE'],
  UK: ['LSE'],
};

function exchangeMatchesPortfolioMarket(exchange: string, market: string): boolean {
  if (!market) return true;
  const normalizedExchange = exchange.toUpperCase();
  if (normalizedExchange === market) return true;
  return (MARKET_ALIASES[market] || []).includes(normalizedExchange);
}

async function loadPortfolioSymbols(userId?: string): Promise<PortfolioSymbol[]> {
  if (!userId) return [];
  const positions = await prisma.portfolioPosition.findMany({
    where: { userId },
    select: { id: true, tickerBbg: true, longShort: true },
  });

  return positions.flatMap((position) => {
    const parsed = parsePortfolioTicker(position.tickerBbg || '');
    if (!parsed) return [];
    return [{ ...parsed, id: position.id, longShort: position.longShort }];
  });
}

function annotatePortfolioMatches(rows: EodhdScreenerRow[], portfolioSymbols: PortfolioSymbol[]): EodhdScreenerRow[] {
  return rows.map((row) => {
    const match = portfolioSymbols.find(
      (symbol) => symbol.code === row.code.toUpperCase()
        && exchangeMatchesPortfolioMarket(row.exchange, symbol.market),
    );
    if (!match) return row;
    return {
      ...row,
      inPortfolio: true,
      portfolioPositionId: match.id,
      portfolioLongShort: match.longShort,
    };
  });
}

function sortRows(rows: EodhdScreenerRow[], sort = 'market_capitalization.desc'): EodhdScreenerRow[] {
  const [field, direction] = sort.split('.');
  const dir = direction === 'asc' ? 1 : -1;
  const accessors: Record<string, (row: EodhdScreenerRow) => number | string | undefined> = {
    market_capitalization: (row) => row.marketCap,
    adjusted_close: (row) => row.close,
    refund_1d_p: (row) => row.return1dPct,
    refund_5d_p: (row) => row.return5dPct,
    avgvol_1d: (row) => row.volume1d,
    avgvol_200d: (row) => row.avgVol200d,
    price_vs_ma5: (row) => row.priceVsMa5Pct,
    name: (row) => row.name,
    code: (row) => row.code,
  };
  const accessor = accessors[field] || accessors.market_capitalization;

  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv)) * dir;
    }
    return (av - bv) * dir;
  });
}

export async function screenStocks(
  filters: EodhdScreenerFilters,
  userId?: string,
): Promise<EodhdScreenerResponse> {
  const limit = clampLimit(filters.limit);
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));
  const exchanges = await resolveExchangeCodes(filters);
  const warnings: string[] = [];

  if (exchanges.length === 0) {
    return {
      items: [],
      total: 0,
      limit,
      offset,
      meta: {
        generatedAt: new Date().toISOString(),
        exchanges: [],
        rawCount: 0,
        ma5Filtered: false,
        warnings: ['No EODHD exchange matched the selected country.'],
      },
    };
  }

  const perExchangeLimit = Math.min(MAX_LIMIT, Math.max(limit + offset, limit));
  let usedEodOnlyFallback = false;
  const batches = await Promise.all(
    exchanges.map(async (exchange) => {
      try {
        return await fetchScreenerForExchange(filters, exchange, perExchangeLimit);
      } catch (error) {
        if (!isEodOnlyPermissionError(error)) throw error;
        usedEodOnlyFallback = true;
        return fetchEodOnlyForExchange(filters, exchange, perExchangeLimit);
      }
    }),
  );
  let rows = batches.flat();
  const rawCount = rows.length;

  const shouldUseMa5 = needsMa5(filters);
  if (!usedEodOnlyFallback && (shouldUseMa5 || (filters.sort || '').startsWith('price_vs_ma5'))) {
    rows = await annotateMa5(rows);
  }
  if (shouldUseMa5) {
    rows = filterByMa5(rows, filters);
  }

  const portfolioSymbols = await loadPortfolioSymbols(userId);
  rows = annotatePortfolioMatches(rows, portfolioSymbols);
  rows = sortRows(rows, filters.sort);

  if (exchanges.length >= 6) {
    warnings.push('Country matched many exchanges. Showing the first 6 EODHD exchanges by priority.');
  }
  if (usedEodOnlyFallback) {
    warnings.push('EODHD Screener is not enabled for the configured token, so this query used the EOD-only fallback.');
    if (hasScreenerOnlyFilters(filters)) {
      warnings.push('Sector, industry, market-cap and 200-day average-volume filters require EODHD Screener/Fundamentals access and were skipped.');
    }
  }

  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
    meta: {
      generatedAt: new Date().toISOString(),
      exchanges,
      rawCount,
      ma5Filtered: shouldUseMa5,
      warnings,
    },
  };
}

export async function getSymbolDetail(symbol: string, days = 220) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.-]+\.[A-Z0-9]+$/.test(normalizedSymbol)) {
    const err = new Error('Invalid EODHD symbol');
    (err as any).status = 400;
    throw err;
  }

  const history = await getPriceHistory(normalizedSymbol, Math.min(Math.max(Number(days) || 220, 30), 720));
  return {
    symbol: normalizedSymbol,
    history,
    latest: history[history.length - 1] || null,
    generatedAt: new Date().toISOString(),
  };
}
