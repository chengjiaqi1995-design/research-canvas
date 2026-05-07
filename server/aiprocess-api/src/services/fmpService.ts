import axios from 'axios';
import crypto from 'crypto';
import prisma from '../utils/db';
import type {
  EodhdExchange,
  EodhdPricePoint,
  EodhdScreenerFilters,
  EodhdScreenerResponse,
  EodhdScreenerRow,
} from './eodhdService';
import { bbgToFmpSymbolCandidates } from './fmpSymbolMapper';

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

export async function fmpGet<T>(path: string, params: Record<string, unknown>, ttlMs = 0, tokenOverride?: string): Promise<T> {
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
  if (Object.keys(obj).length > 0) return [obj as RawFmpRow];
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
    ma10: movingAverage(points, index, 10),
    ma20: movingAverage(points, index, 20),
    ma25: movingAverage(points, index, 25),
    ma50: movingAverage(points, index, 50),
    ma100: movingAverage(points, index, 100),
  }));
}

export type FmpTechnicalStrategy =
  | 'none'
  | 'range_breakout_20d'
  | 'range_breakout_55d'
  | 'ma_trend_stack'
  | 'rsi_momentum'
  | 'bollinger_squeeze_breakout'
  | 'macd_bull_cross'
  | 'pullback_to_ma'
  | 'relative_strength';

export interface FmpStockNewsItem {
  symbol: string;
  title: string;
  text: string;
  site: string;
  url: string;
  image?: string;
  publishedAt: string;
}

export interface FmpEarningsCalendarItem {
  symbol: string;
  date: string;
  time?: string;
  fiscalDateEnding?: string;
  quarter?: number;
  year?: number;
}

export interface FmpTranscriptDateItem {
  symbol: string;
  date: string;
  quarter?: number;
  year?: number;
}

export interface FmpTranscriptItem {
  symbol: string;
  date?: string;
  quarter?: number;
  year?: number;
  title?: string;
  content: string;
}

export interface FmpSicIndustry {
  office?: string;
  sicCode: string;
  industryTitle: string;
}

export interface FmpMarketClassifications {
  provider: 'fmp';
  generatedAt: string;
  sectors: string[];
  industries: string[];
  sicIndustries: FmpSicIndustry[];
}

const FMP_EXCHANGES: EodhdExchange[] = [
  { code: 'US', name: 'United States', country: 'United States', countryIso2: 'US', countryIso3: 'USA', currency: 'USD' },
  { code: 'NASDAQ', name: 'NASDAQ', country: 'United States', countryIso2: 'US', countryIso3: 'USA', currency: 'USD' },
  { code: 'NYSE', name: 'NYSE', country: 'United States', countryIso2: 'US', countryIso3: 'USA', currency: 'USD' },
  { code: 'AMEX', name: 'NYSE American', country: 'United States', countryIso2: 'US', countryIso3: 'USA', currency: 'USD' },
  { code: 'HK', name: 'Hong Kong', country: 'Hong Kong', countryIso2: 'HK', countryIso3: 'HKG', currency: 'HKD' },
  { code: 'T', name: 'Tokyo', country: 'Japan', countryIso2: 'JP', countryIso3: 'JPN', currency: 'JPY' },
  { code: 'NS', name: 'NSE India', country: 'India', countryIso2: 'IN', countryIso3: 'IND', currency: 'INR' },
  { code: 'BO', name: 'BSE India', country: 'India', countryIso2: 'IN', countryIso3: 'IND', currency: 'INR' },
  { code: 'SS', name: 'Shanghai', country: 'China', countryIso2: 'CN', countryIso3: 'CHN', currency: 'CNY' },
  { code: 'SZ', name: 'Shenzhen', country: 'China', countryIso2: 'CN', countryIso3: 'CHN', currency: 'CNY' },
  { code: 'L', name: 'London', country: 'United Kingdom', countryIso2: 'GB', countryIso3: 'GBR', currency: 'GBP' },
  { code: 'PA', name: 'Paris', country: 'France', countryIso2: 'FR', countryIso3: 'FRA', currency: 'EUR' },
  { code: 'DE', name: 'Xetra/Germany', country: 'Germany', countryIso2: 'DE', countryIso3: 'DEU', currency: 'EUR' },
  { code: 'TO', name: 'Toronto', country: 'Canada', countryIso2: 'CA', countryIso3: 'CAN', currency: 'CAD' },
  { code: 'AX', name: 'Australia', country: 'Australia', countryIso2: 'AU', countryIso3: 'AUS', currency: 'AUD' },
];

const FMP_SCREENER_EXCHANGE_PARAM: Record<string, string> = {
  NASDAQ: 'NASDAQ',
  NYSE: 'NYSE',
  AMEX: 'AMEX',
  HK: 'HKSE',
  T: 'JPX',
  NS: 'NSE',
  BO: 'BSE',
  SS: 'SHH',
  SZ: 'SHZ',
  L: 'LSE',
  PA: 'EURONEXT',
  DE: 'XETRA',
  TO: 'TSX',
  AX: 'ASX',
};

const FMP_SUFFIX_TO_EXCHANGE: Record<string, string> = {
  HK: 'HK',
  T: 'T',
  NS: 'NS',
  BO: 'BO',
  SS: 'SS',
  SHG: 'SS',
  SZ: 'SZ',
  SHE: 'SZ',
  L: 'L',
  PA: 'PA',
  DE: 'DE',
  TO: 'TO',
  AX: 'AX',
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function fmpHistorySymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (/^[A-Z0-9-]+\.US$/.test(normalized)) return normalized.replace(/\.US$/, '');
  return normalized;
}

function symbolParts(symbol: string, rawExchange?: string): { code: string; exchange: string } {
  const normalized = symbol.trim().toUpperCase();
  const [code, suffix] = normalized.split('.');
  if (suffix) return { code, exchange: FMP_SUFFIX_TO_EXCHANGE[suffix] || suffix };
  const exchange = cleanString(rawExchange).toUpperCase();
  return { code: normalized, exchange: exchange && exchange !== 'NASDAQ' && exchange !== 'NYSE' ? exchange : 'US' };
}

export function listFmpExchanges(): EodhdExchange[] {
  return FMP_EXCHANGES;
}

export type FmpSymbolResolveInputType = 'fmp' | 'bbg' | 'unknown';

export interface FmpSymbolResolveCandidate {
  symbol: string;
  companyName?: string;
  exchange?: string;
  country?: string;
  currency?: string;
  score: number;
  source: 'fmp-input' | 'bbg-map';
  reason?: string;
}

export interface FmpSymbolResolveResult {
  input: string;
  inputType: FmpSymbolResolveInputType;
  resolved: boolean;
  symbol?: string;
  companyName?: string;
  confidence: number;
  candidates: FmpSymbolResolveCandidate[];
  warnings: string[];
}

const BBG_SUFFIX_PATTERN = [
  'US', 'UN', 'UQ', 'UP',
  'HK', 'HKEX',
  'JP', 'JT',
  'CH', 'CG', 'CS', 'CN', 'SH', 'SHG', 'SZ', 'SHE',
  'IN', 'IB',
  'KS', 'KQ', 'TT', 'TW',
  'SP', 'SI',
  'LN', 'LI', 'UK', 'LSE',
  'FP', 'PA', 'GR', 'GY', 'DE',
  'SW', 'VX', 'SS', 'ST', 'NO', 'OL',
  'DC', 'CO', 'BB', 'BR', 'FH', 'HE',
  'CA', 'CT', 'AU', 'AT', 'NA', 'AS', 'IM', 'IT', 'SM', 'MC', 'ID', 'IJ',
].join('|');

function normalizeResolverInput(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[.$([{]+/, '')
    .replace(/[\])},;；:：]+$/, '');
}

function normalizeFmpSymbolInput(value: string): string {
  return normalizeResolverInput(value).toUpperCase().replace(/\s+EQUITY$/i, '');
}

function isLikelyFmpSymbolInput(value: string): boolean {
  const text = normalizeFmpSymbolInput(value);
  if (!text || /\s/.test(text)) return false;
  return /^[A-Z0-9][A-Z0-9.-]{0,24}$/.test(text);
}

function isLikelyBbgTickerInput(value: string): boolean {
  const text = normalizeResolverInput(value);
  if (!text) return false;
  const suffixPattern = new RegExp(`^[A-Z0-9/.-]+\\s+(?:${BBG_SUFFIX_PATTERN})(?:\\s+EQUITY)?$`, 'i');
  return suffixPattern.test(text);
}

function normalizeCompanyForMatch(value?: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) =>
      token.length >= 2 &&
      !['the', 'and', 'inc', 'corp', 'corporation', 'company', 'co', 'ltd', 'limited', 'plc', 'sa', 'nv', 'ag', 'asa', 'oyj', 'spa', 'pte', 'holdings', 'holding', 'group'].includes(token)
    );
}

function companyMatchScore(candidateName?: string, companyHint?: string): number | undefined {
  const candidateTokens = normalizeCompanyForMatch(candidateName);
  const hintTokens = normalizeCompanyForMatch(companyHint);
  if (!candidateTokens.length || !hintTokens.length) return undefined;
  const candidateSet = new Set(candidateTokens);
  const matches = hintTokens.filter((token) => candidateSet.has(token)).length;
  return matches / Math.max(1, hintTokens.length);
}

function candidateScore(base: number, candidateName?: string, companyHint?: string): number {
  const match = companyMatchScore(candidateName, companyHint);
  if (match == null) return base;
  if (match >= 0.75) return Math.min(0.99, base + 0.04);
  if (match >= 0.45) return Math.min(0.97, base + 0.02);
  return Math.max(0.45, base - 0.25);
}

function normalizeFmpProfileCandidate(
  raw: RawFmpRow,
  fallbackSymbol: string,
  source: FmpSymbolResolveCandidate['source'],
  baseScore: number,
  companyHint?: string,
  reason?: string,
): FmpSymbolResolveCandidate | null {
  const profileSymbol = pickString(raw, ['symbol', 'ticker']);
  const companyName = pickString(raw, ['companyName', 'name']);
  if (!profileSymbol && !companyName) return null;
  const symbol = normalizeFmpSymbolInput(profileSymbol || fallbackSymbol);
  if (!symbol) return null;
  return {
    symbol: fmpHistorySymbol(symbol),
    companyName: companyName || undefined,
    exchange: pickString(raw, ['exchangeShortName', 'exchange']) || undefined,
    country: pickString(raw, ['country']) || undefined,
    currency: pickString(raw, ['currency', 'currencySymbol']) || undefined,
    score: candidateScore(baseScore, companyName, companyHint),
    source,
    reason,
  };
}

async function getFmpProfileCandidate(
  symbol: string,
  source: FmpSymbolResolveCandidate['source'],
  baseScore: number,
  companyHint?: string,
  reason?: string,
  tokenOverride?: string,
): Promise<FmpSymbolResolveCandidate | null> {
  const safeSymbol = fmpHistorySymbol(normalizeFmpSymbolInput(symbol));
  if (!safeSymbol) return null;
  const rows = extractRawRows(await fmpGet<unknown>(
    '/profile',
    { symbol: safeSymbol },
    24 * 60 * 60 * 1000,
    tokenOverride,
  ));
  if (!rows.length) return null;
  return normalizeFmpProfileCandidate(rows[0] || {}, safeSymbol, source, baseScore, companyHint, reason);
}

export async function resolveFmpSymbol(params: {
  input: string;
  companyName?: string;
  tokenOverride?: string;
}): Promise<FmpSymbolResolveResult> {
  const input = normalizeResolverInput(params.input);
  const companyName = cleanString(params.companyName);
  const warnings: string[] = [];
  if (!input) {
    return {
      input,
      inputType: 'unknown',
      resolved: false,
      confidence: 0,
      candidates: [],
      warnings: ['empty ticker input'],
    };
  }

  const inputType: FmpSymbolResolveInputType = isLikelyBbgTickerInput(input)
    ? 'bbg'
    : isLikelyFmpSymbolInput(input) ? 'fmp' : 'unknown';

  const candidatesToCheck: Array<{
    symbol: string;
    source: FmpSymbolResolveCandidate['source'];
    baseScore: number;
    reason: string;
  }> = [];

  if (inputType === 'fmp') {
    candidatesToCheck.push({
      symbol: normalizeFmpSymbolInput(input),
      source: 'fmp-input',
      baseScore: 0.96,
      reason: 'validated direct FMP symbol input',
    });
  }

  const bbgCandidates = isLikelyBbgTickerInput(input) || inputType === 'unknown'
    ? bbgToFmpSymbolCandidates(input)
    : [];
  for (const symbol of bbgCandidates) {
    candidatesToCheck.push({
      symbol,
      source: 'bbg-map',
      baseScore: inputType === 'bbg' ? 0.92 : 0.78,
      reason: 'mapped from Bloomberg ticker suffix',
    });
  }

  const uniqueCandidates = Array.from(
    new Map(candidatesToCheck.map((item) => [normalizeFmpSymbolInput(item.symbol), item])).values(),
  );

  const validated: FmpSymbolResolveCandidate[] = [];
  for (const candidate of uniqueCandidates.slice(0, 10)) {
    try {
      const profile = await getFmpProfileCandidate(
        candidate.symbol,
        candidate.source,
        candidate.baseScore,
        companyName,
        candidate.reason,
        params.tokenOverride,
      );
      if (profile) validated.push(profile);
    } catch (error) {
      warnings.push(`${candidate.symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  validated.sort((a, b) => b.score - a.score);
  const best = validated[0];
  if (!best) {
    return {
      input,
      inputType,
      resolved: false,
      confidence: 0,
      candidates: [],
      warnings: warnings.length ? warnings : ['no FMP profile match for ticker input'],
    };
  }

  return {
    input,
    inputType,
    resolved: best.score >= 0.5,
    symbol: best.symbol,
    companyName: best.companyName,
    confidence: Number(best.score.toFixed(2)),
    candidates: validated.slice(0, 5),
    warnings,
  };
}

function extractRawRows(raw: unknown): RawFmpRow[] {
  return extractRows(raw);
}

function normalizeSector(raw: RawFmpRow): string {
  return pickString(raw, ['sector', 'name', 'value']);
}

function normalizeIndustry(raw: RawFmpRow): string {
  return pickString(raw, ['industry', 'name', 'value']);
}

function normalizeSicIndustry(raw: RawFmpRow): FmpSicIndustry | null {
  const sicCode = pickString(raw, ['sicCode', 'sic_code', 'code']);
  const industryTitle = pickString(raw, ['industryTitle', 'industry_title', 'title', 'name']);
  if (!sicCode || !industryTitle) return null;
  return {
    office: pickString(raw, ['office', 'Office']) || undefined,
    sicCode,
    industryTitle,
  };
}

function normalizeSicSymbolClassification(raw: RawFmpRow): (FmpSicIndustry & { symbol: string }) | null {
  const sic = normalizeSicIndustry(raw);
  const symbol = pickString(raw, ['symbol', 'ticker']);
  if (!sic || !symbol) return null;
  return {
    ...sic,
    symbol: fmpHistorySymbol(symbol),
  };
}

export async function listMarketClassifications(tokenOverride?: string): Promise<FmpMarketClassifications> {
  const [sectorsRaw, industriesRaw, sicRaw] = await Promise.all([
    fmpGet<unknown>('/available-sectors', {}, 24 * 60 * 60 * 1000, tokenOverride),
    fmpGet<unknown>('/available-industries', {}, 24 * 60 * 60 * 1000, tokenOverride),
    fmpGet<unknown>('/standard-industrial-classification-list', {}, 24 * 60 * 60 * 1000, tokenOverride),
  ]);

  const sectors = Array.from(new Set(extractRawRows(sectorsRaw).map(normalizeSector).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const industries = Array.from(new Set(extractRawRows(industriesRaw).map(normalizeIndustry).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const sicByCode = new Map<string, FmpSicIndustry>();
  for (const item of extractRawRows(sicRaw).map(normalizeSicIndustry).filter((item): item is FmpSicIndustry => Boolean(item))) {
    sicByCode.set(item.sicCode, item);
  }

  return {
    provider: 'fmp',
    generatedAt: new Date().toISOString(),
    sectors,
    industries,
    sicIndustries: Array.from(sicByCode.values()).sort((a, b) => Number(a.sicCode) - Number(b.sicCode) || a.industryTitle.localeCompare(b.industryTitle)),
  };
}

async function getSicClassification(symbol: string, tokenOverride?: string): Promise<FmpSicIndustry | null> {
  const safeSymbol = fmpHistorySymbol(symbol);
  const rows = extractRawRows(await fmpGet<unknown>(
    '/industry-classification-search',
    { symbol: safeSymbol },
    7 * 24 * 60 * 60 * 1000,
    tokenOverride,
  ));
  return normalizeSicIndustry(rows[0] || {});
}

async function searchSicClassificationsByCode(sicCode: string, tokenOverride?: string): Promise<Array<FmpSicIndustry & { symbol: string }>> {
  const rows = extractRawRows(await fmpGet<unknown>(
    '/industry-classification-search',
    { sicCode },
    7 * 24 * 60 * 60 * 1000,
    tokenOverride,
  ));
  return rows
    .map(normalizeSicSymbolClassification)
    .filter((item): item is FmpSicIndustry & { symbol: string } => Boolean(item));
}

function normalizeFmpScreenerRow(raw: RawFmpRow): EodhdScreenerRow | null {
  const symbol = pickString(raw, ['symbol', 'ticker']);
  if (!symbol) return null;
  const exchangeShortName = pickString(raw, ['exchangeShortName', 'exchange']);
  const parts = symbolParts(symbol, exchangeShortName);
  const close = pickNumber(raw, ['price', 'close', 'previousClose']);
  return {
    symbol: fmpHistorySymbol(symbol),
    code: parts.code,
    exchange: parts.exchange,
    provider: 'fmp',
    name: pickString(raw, ['companyName', 'name']) || parts.code,
    country: pickString(raw, ['country']),
    currency: pickString(raw, ['currency', 'currencySymbol']),
    sector: pickString(raw, ['sector']),
    industry: pickString(raw, ['industry']),
    sicCode: pickString(raw, ['sicCode', 'sic_code']) || undefined,
    sicIndustryTitle: pickString(raw, ['sicIndustryTitle', 'industryTitle', 'sicIndustry']) || undefined,
    marketCap: pickNumber(raw, ['marketCap', 'market_cap', 'marketCapitalization']),
    close,
    volume1d: pickNumber(raw, ['volume', 'avgVolume', 'avgVol']),
  };
}

function usesSicClassification(filters: EodhdScreenerFilters): boolean {
  return cleanString(filters.classificationSource) === 'sec-sic' || Boolean(cleanString(filters.sicCode) || cleanString(filters.sicIndustryTitle));
}

function hasSicFilter(filters: EodhdScreenerFilters): boolean {
  return Boolean(cleanString(filters.sicCode) || cleanString(filters.sicIndustryTitle));
}

function buildFmpScreenerParams(filters: EodhdScreenerFilters, candidateLimit: number): Record<string, unknown> {
  const params: Record<string, unknown> = {
    isActivelyTrading: true,
    limit: candidateLimit,
  };
  const country = cleanString(filters.country).toUpperCase();
  const exchange = cleanString(filters.exchange).toUpperCase();
  const sector = cleanString(filters.sector);
  const industry = cleanString(filters.industry);
  const useSic = usesSicClassification(filters);

  if (country && country !== 'ALL') params.country = country;
  if (exchange && exchange !== 'ALL' && exchange !== 'US') {
    params.exchange = FMP_SCREENER_EXCHANGE_PARAM[exchange] || exchange;
  }
  if (sector) params.sector = sector;
  if (industry && !useSic) params.industry = industry;

  const marketCapMin = cleanNumber(filters.marketCapMin);
  const marketCapMax = cleanNumber(filters.marketCapMax);
  const priceMin = cleanNumber(filters.priceMin);
  const priceMax = cleanNumber(filters.priceMax);
  const volumeMin = cleanNumber(filters.volumeMin);
  const volumeMax = cleanNumber(filters.volumeMax);

  if (marketCapMin !== undefined) params.marketCapMoreThan = marketCapMin;
  if (marketCapMax !== undefined) params.marketCapLowerThan = marketCapMax;
  if (priceMin !== undefined) params.priceMoreThan = priceMin;
  if (priceMax !== undefined) params.priceLowerThan = priceMax;
  if (volumeMin !== undefined) params.volumeMoreThan = volumeMin;
  if (volumeMax !== undefined) params.volumeLowerThan = volumeMax;

  return params;
}

function sicMatches(row: EodhdScreenerRow, filters: EodhdScreenerFilters): boolean {
  if (!hasSicFilter(filters)) return true;
  const sicCode = cleanString(filters.sicCode).toLowerCase();
  const sicIndustryTitle = cleanString(filters.sicIndustryTitle).toLowerCase();
  if (sicCode && cleanString(row.sicCode).toLowerCase() !== sicCode) return false;
  if (sicIndustryTitle && !cleanString(row.sicIndustryTitle).toLowerCase().includes(sicIndustryTitle)) return false;
  return Boolean(row.sicCode || row.sicIndustryTitle);
}

async function annotateSicClassifications(
  rows: EodhdScreenerRow[],
  filters: EodhdScreenerFilters,
  tokenOverride?: string,
): Promise<EodhdScreenerRow[]> {
  if (!hasSicFilter(filters)) return rows;
  const sicCode = cleanString(filters.sicCode);
  if (sicCode) {
    try {
      const matches = await searchSicClassificationsByCode(sicCode, tokenOverride);
      const bySymbol = new Map(matches.map((match) => [match.symbol, match]));
      return rows
        .map((row) => {
          const match = bySymbol.get(fmpHistorySymbol(row.symbol));
          return match
            ? { ...row, sicCode: match.sicCode, sicIndustryTitle: match.industryTitle }
            : row;
        })
        .filter((row) => sicMatches(row, filters));
    } catch {
      // Fall back to per-symbol lookup below.
    }
  }
  const annotated = await mapWithConcurrency(rows, 8, async (row) => {
    if (row.sicCode && row.sicIndustryTitle) return row;
    try {
      const sic = await getSicClassification(row.symbol, tokenOverride);
      if (!sic) return row;
      return {
        ...row,
        sicCode: sic.sicCode,
        sicIndustryTitle: sic.industryTitle,
      };
    } catch {
      return row;
    }
  });
  return annotated.filter((row) => sicMatches(row, filters));
}

async function getFmpScreenerRows(filters: EodhdScreenerFilters, candidateLimit: number, tokenOverride?: string): Promise<RawFmpRow[]> {
  const params = buildFmpScreenerParams(filters, candidateLimit);
  try {
    return extractRawRows(await fmpGet<unknown>('/company-screener', params, 15 * 60 * 1000, tokenOverride));
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    const status = Number(error?.status);
    if (status === 404 || message.includes('not found') || message.includes('cannot get')) {
      return extractRawRows(await fmpGet<unknown>('/stock-screener', params, 15 * 60 * 1000, tokenOverride));
    }
    throw error;
  }
}

function pct(current?: number, previous?: number): number | undefined {
  if (current == null || previous == null || previous === 0) return undefined;
  return (current / previous - 1) * 100;
}

function valuesUpTo(points: EodhdPricePoint[], endExclusive: number, lookback: number, key: 'high' | 'low' | 'volume' | 'close'): number[] {
  const start = Math.max(0, endExclusive - lookback);
  return points.slice(start, endExclusive)
    .map((point) => {
      if (key === 'close') return point.adjustedClose ?? point.close;
      return point[key];
    })
    .filter((value): value is number => value != null && Number.isFinite(value));
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[], mean: number): number | undefined {
  if (!values.length) return undefined;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let current = values[0];
  for (const value of values) {
    current = result.length === 0 ? value : value * k + current * (1 - k);
    result.push(current);
  }
  return result;
}

function calcRsi(values: number[], period = 14): number | undefined {
  if (values.length <= period) return undefined;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcMacd(values: number[]): { macd?: number; signal?: number; hist?: number; previousHist?: number } {
  if (values.length < 35) return {};
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdSeries = values.map((_, index) => ema12[index] - ema26[index]);
  const signalSeries = ema(macdSeries, 9);
  const index = macdSeries.length - 1;
  const previousIndex = index - 1;
  return {
    macd: macdSeries[index],
    signal: signalSeries[index],
    hist: macdSeries[index] - signalSeries[index],
    previousHist: previousIndex >= 0 ? macdSeries[previousIndex] - signalSeries[previousIndex] : undefined,
  };
}

function strategyLabel(strategy: string): string {
  const labels: Record<string, string> = {
    range_breakout_20d: '20D 区间突破',
    range_breakout_55d: '55D 区间突破',
    ma_trend_stack: '均线多头排列',
    rsi_momentum: 'RSI 动量',
    bollinger_squeeze_breakout: 'Bollinger 窄幅突破',
    macd_bull_cross: 'MACD bullish cross',
    pullback_to_ma: '回踩均线',
    relative_strength: '相对强度',
  };
  return labels[strategy] || strategy;
}

function evaluateStrategy(row: EodhdScreenerRow, strategy: string): { matched: boolean; notes: string[] } {
  if (!strategy || strategy === 'none') return { matched: true, notes: [] };
  const notes: string[] = [];
  const close = row.close;
  const ma20 = row.ma20;
  const ma50 = row.ma50;
  const ma100 = row.ma100;
  const rsi = row.rsi14;
  const volumeRatio = row.volumeRatio20;
  const macdHist = row.macdHist;
  const high20 = row.rangeHigh20DistancePct;
  const high55 = row.rangeHigh55DistancePct;
  const bandwidth = row.bollingerBandwidthPct;

  if (strategy === 'range_breakout_20d') {
    const matched = high20 != null && high20 >= -0.5 && (volumeRatio == null || volumeRatio >= 1.2);
    if (matched) notes.push('收盘接近/突破 20D 高点', volumeRatio != null ? `量比 ${volumeRatio.toFixed(2)}x` : '');
    return { matched, notes: notes.filter(Boolean) };
  }
  if (strategy === 'range_breakout_55d') {
    const matched = high55 != null && high55 >= -0.8 && (volumeRatio == null || volumeRatio >= 1.1);
    if (matched) notes.push('收盘接近/突破 55D 高点', volumeRatio != null ? `量比 ${volumeRatio.toFixed(2)}x` : '');
    return { matched, notes: notes.filter(Boolean) };
  }
  if (strategy === 'ma_trend_stack') {
    const matched = close != null && ma20 != null && ma50 != null && ma100 != null && close > ma20 && ma20 > ma50 && ma50 > ma100;
    if (matched) notes.push('Close > MA20 > MA50 > MA100');
    return { matched, notes };
  }
  if (strategy === 'rsi_momentum') {
    const matched = rsi != null && rsi >= 55 && rsi <= 72 && close != null && ma20 != null && close > ma20;
    if (matched) notes.push(`RSI ${rsi.toFixed(1)} 动量区间`, '价格高于 MA20');
    return { matched, notes };
  }
  if (strategy === 'bollinger_squeeze_breakout') {
    const matched = bandwidth != null && bandwidth <= 12 && high20 != null && high20 >= -1 && (volumeRatio == null || volumeRatio >= 1.1);
    if (matched) notes.push(`带宽 ${bandwidth.toFixed(1)}%`, '向上突破窄幅区间');
    return { matched, notes };
  }
  if (strategy === 'macd_bull_cross') {
    const matched = macdHist != null && macdHist > 0 && close != null && ma20 != null && close > ma20;
    if (matched) notes.push(`MACD Hist ${macdHist.toFixed(3)} 转正`, '价格高于 MA20');
    return { matched, notes };
  }
  if (strategy === 'pullback_to_ma') {
    const distance = close != null && ma20 ? Math.abs(close / ma20 - 1) * 100 : undefined;
    const matched = close != null && ma20 != null && ma50 != null && ma20 > ma50 && distance != null && distance <= 3 && rsi != null && rsi >= 38 && rsi <= 62;
    if (matched) notes.push(`距离 MA20 ${distance!.toFixed(1)}%`, '上升趋势内回踩');
    return { matched, notes };
  }
  if (strategy === 'relative_strength') {
    const matched = (row.return5dPct ?? 0) >= 5 || (row.priceVsMa5Pct ?? 0) >= 5 || (row.rangeHigh55DistancePct ?? -100) >= -2;
    if (matched) notes.push('短期相对强度靠前');
    return { matched, notes };
  }
  return { matched: true, notes: [strategyLabel(strategy)] };
}

function annotateTechnicalMetrics(row: EodhdScreenerRow, history: EodhdPricePoint[], strategy: string): EodhdScreenerRow | null {
  const latestIndex = history.length - 1;
  const latest = history[latestIndex];
  if (!latest) return null;
  const close = latest.adjustedClose ?? latest.close;
  if (close == null) return null;

  const closes = history.map((point) => point.adjustedClose ?? point.close).filter((value): value is number => value != null);
  const previousClose = closes[closes.length - 2];
  const close5 = closes[closes.length - 6];
  const ma20 = latest.ma20;
  const ma50 = latest.ma50;
  const ma100 = latest.ma100;
  const previousHigh20 = valuesUpTo(history, latestIndex, 20, 'high');
  const previousHigh55 = valuesUpTo(history, latestIndex, 55, 'high');
  const high20 = previousHigh20.length ? Math.max(...previousHigh20) : undefined;
  const high55 = previousHigh55.length ? Math.max(...previousHigh55) : undefined;
  const volumeAvg20 = average(valuesUpTo(history, latestIndex, 20, 'volume'));
  const close20 = valuesUpTo(history, latestIndex + 1, 20, 'close');
  const mean20 = average(close20);
  const stdev20 = mean20 == null ? undefined : stddev(close20, mean20);
  const macd = calcMacd(closes);

  const annotated: EodhdScreenerRow = {
    ...row,
    close,
    ma5: latest.ma5,
    ma20,
    ma50,
    ma100,
    ma5Date: latest.date,
    volume1d: latest.volume ?? row.volume1d,
    return1dPct: pct(close, previousClose),
    return5dPct: pct(close, close5),
    priceVsMa5Pct: latest.ma5 ? pct(close, latest.ma5) : undefined,
    rsi14: calcRsi(closes, 14),
    macd: macd.macd,
    macdSignal: macd.signal,
    macdHist: macd.hist,
    volumeRatio20: volumeAvg20 && latest.volume ? latest.volume / volumeAvg20 : undefined,
    rangeHigh20DistancePct: high20 ? pct(close, high20) : undefined,
    rangeHigh55DistancePct: high55 ? pct(close, high55) : undefined,
    bollingerBandwidthPct: mean20 && stdev20 ? ((4 * stdev20) / mean20) * 100 : undefined,
    maStack: close != null && ma20 != null && ma50 != null && ma100 != null && close > ma20 && ma20 > ma50 && ma50 > ma100
      ? 'bull'
      : close != null && ma20 != null && ma50 != null && ma100 != null && close < ma20 && ma20 < ma50 && ma50 < ma100
        ? 'bear'
        : 'mixed',
  };
  const result = evaluateStrategy(annotated, strategy);
  return {
    ...annotated,
    strategyMatched: result.matched,
    strategyNotes: result.notes,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return result;
}

function rowMatchesFilters(row: EodhdScreenerRow, filters: EodhdScreenerFilters): boolean {
  const query = cleanString(filters.query).toLowerCase();
  if (query && !row.symbol.toLowerCase().includes(query) && !row.code.toLowerCase().includes(query) && !row.name.toLowerCase().includes(query)) return false;
  const sector = cleanString(filters.sector).toLowerCase();
  if (sector && !(row.sector || '').toLowerCase().includes(sector)) return false;
  const industry = cleanString(filters.industry).toLowerCase();
  if (industry && !usesSicClassification(filters) && !(row.industry || '').toLowerCase().includes(industry)) return false;
  if (!sicMatches(row, filters)) return false;

  const ranges: Array<[number | undefined, unknown, unknown]> = [
    [row.marketCap, filters.marketCapMin, filters.marketCapMax],
    [row.close, filters.priceMin, filters.priceMax],
    [row.return1dPct, filters.return1dMin, filters.return1dMax],
    [row.return5dPct, filters.return5dMin, filters.return5dMax],
    [row.volume1d, filters.volumeMin, filters.volumeMax],
    [row.priceVsMa5Pct, filters.ma5DistanceMin, filters.ma5DistanceMax],
  ];
  for (const [value, minRaw, maxRaw] of ranges) {
    const min = cleanNumber(minRaw);
    const max = cleanNumber(maxRaw);
    if (min !== undefined && (value == null || value < min)) return false;
    if (max !== undefined && (value == null || value > max)) return false;
  }
  const ma5Filter = filters.priceVsMa5 || 'any';
  if (ma5Filter === 'above' && (row.priceVsMa5Pct == null || row.priceVsMa5Pct <= 0)) return false;
  if (ma5Filter === 'below' && (row.priceVsMa5Pct == null || row.priceVsMa5Pct >= 0)) return false;
  const strategy = cleanString(filters.strategy);
  if (strategy && strategy !== 'none' && !row.strategyMatched) return false;
  return true;
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
    price_vs_ma5: (row) => row.priceVsMa5Pct,
    rsi14: (row) => row.rsi14,
    macd_hist: (row) => row.macdHist,
    range_high_20d: (row) => row.rangeHigh20DistancePct,
    range_high_55d: (row) => row.rangeHigh55DistancePct,
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
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir;
  });
}

async function annotatePortfolioMatches(rows: EodhdScreenerRow[], userId?: string): Promise<EodhdScreenerRow[]> {
  if (!userId) return rows;
  const positions = await prisma.portfolioPosition.findMany({
    where: { userId },
    select: { id: true, tickerBbg: true, market: true, longShort: true },
  });
  const bySymbol = new Map<string, { id: number; longShort: string }>();
  for (const position of positions) {
    for (const candidate of bbgToFmpSymbolCandidates(position.tickerBbg, position.market)) {
      bySymbol.set(fmpHistorySymbol(candidate), { id: position.id, longShort: position.longShort });
    }
  }
  return rows.map((row) => {
    const match = bySymbol.get(fmpHistorySymbol(row.symbol));
    return match
      ? { ...row, inPortfolio: true, portfolioPositionId: match.id, portfolioLongShort: match.longShort }
      : row;
  });
}

export async function screenStocks(
  filters: EodhdScreenerFilters,
  userId?: string,
  tokenOverride?: string,
): Promise<EodhdScreenerResponse> {
  const limit = clampLimit(filters.limit);
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));
  const strategy = cleanString(filters.strategy) || 'none';
  const useSic = usesSicClassification(filters);
  const sicFiltered = hasSicFilter(filters);
  const candidateLimit = sicFiltered
    ? 1000
    : Math.min(useSic ? 500 : 300, Math.max(limit + offset, limit) * (strategy === 'none' ? (useSic ? 6 : 4) : (useSic ? 8 : 6)));
  const rawRows = await getFmpScreenerRows(filters, candidateLimit, tokenOverride);
  let normalized = rawRows
    .map(normalizeFmpScreenerRow)
    .filter((row): row is EodhdScreenerRow => Boolean(row));
  normalized = await annotateSicClassifications(normalized, filters, tokenOverride);

  const annotated = await mapWithConcurrency(normalized, 5, async (row) => {
    try {
      const history = await getPriceHistory(row.symbol, 180, tokenOverride);
      return annotateTechnicalMetrics(row, history, strategy);
    } catch {
      return strategy === 'none' && (filters.priceVsMa5 || 'any') === 'any' ? row : null;
    }
  });

  let rows = annotated
    .filter((row): row is EodhdScreenerRow => Boolean(row))
    .filter((row) => rowMatchesFilters(row, filters));
  rows = await annotatePortfolioMatches(rows, userId);
  rows = sortRows(rows, filters.sort);

  const warnings: string[] = [];
  const historySkipped = normalized.length - annotated.filter(Boolean).length;
  if (historySkipped > 0) warnings.push(`FMP 有 ${historySkipped} 个候选缺少可用价格历史，已跳过技术筛选。`);
  if (strategy !== 'none') warnings.push(`已应用技术策略：${strategyLabel(strategy)}。`);
  if (sicFiltered) warnings.push('SEC/SIC 为 FMP 行业分类高级筛选，先用 FMP screener 拉候选后按 SIC 过滤。');

  const exchange = cleanString(filters.exchange);
  const country = cleanString(filters.country);
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
    meta: {
      generatedAt: new Date().toISOString(),
      provider: 'fmp',
      exchanges: [exchange && exchange !== 'all' ? exchange.toUpperCase() : (country || 'US').toUpperCase()],
      rawCount: rawRows.length,
      ma5Filtered: (filters.priceVsMa5 || 'any') !== 'any',
      warnings,
    },
  };
}

export async function getSymbolDetail(symbol: string, days = 220, tokenOverride?: string) {
  const normalizedSymbol = fmpHistorySymbol(symbol);
  const history = await getPriceHistory(normalizedSymbol, Math.min(Math.max(Number(days) || 220, 30), 720), tokenOverride);
  return {
    symbol: normalizedSymbol,
    provider: 'fmp',
    history,
    latest: history[history.length - 1] || null,
    generatedAt: new Date().toISOString(),
  };
}

function normalizeNewsItem(raw: RawFmpRow): FmpStockNewsItem | null {
  const title = pickString(raw, ['title']);
  const url = pickString(raw, ['url', 'link']);
  const publishedAt = pickString(raw, ['publishedDate', 'publishedAt', 'date']);
  if (!title || !url) return null;
  return {
    symbol: pickString(raw, ['symbol', 'ticker']).toUpperCase(),
    title,
    text: pickString(raw, ['text', 'content', 'summary']),
    site: pickString(raw, ['site', 'publisher', 'source']),
    url,
    image: pickString(raw, ['image']),
    publishedAt: publishedAt || new Date().toISOString(),
  };
}

export async function getStockNews(
  symbols: string[],
  params: { from?: string; to?: string; page?: number; limit?: number } = {},
  tokenOverride?: string,
): Promise<FmpStockNewsItem[]> {
  const uniqueSymbols = Array.from(new Set(symbols.map((symbol) => fmpHistorySymbol(symbol)).filter(Boolean))).slice(0, 50);
  if (!uniqueSymbols.length) return [];
  const raw = await fmpGet<unknown>(
    '/news/stock',
    {
      symbols: uniqueSymbols.join(','),
      page: params.page ?? 0,
      limit: Math.min(Math.max(Number(params.limit) || 50, 1), 100),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
    15 * 60 * 1000,
    tokenOverride,
  );
  return extractRawRows(raw)
    .map(normalizeNewsItem)
    .filter((item): item is FmpStockNewsItem => Boolean(item));
}

function normalizeEarningsCalendarItem(raw: RawFmpRow): FmpEarningsCalendarItem | null {
  const symbol = pickString(raw, ['symbol']).toUpperCase();
  const date = pickString(raw, ['date', 'epsDate', 'fiscalDateEnding']);
  if (!symbol || !date) return null;
  return {
    symbol,
    date,
    time: pickString(raw, ['time']),
    fiscalDateEnding: pickString(raw, ['fiscalDateEnding']),
    quarter: pickNumber(raw, ['quarter']),
    year: pickNumber(raw, ['year']),
  };
}

export async function getEarningsCalendar(from: string, to: string, tokenOverride?: string): Promise<FmpEarningsCalendarItem[]> {
  const raw = await fmpGet<unknown>('/earnings-calendar', { from, to }, 60 * 60 * 1000, tokenOverride);
  return extractRawRows(raw)
    .map(normalizeEarningsCalendarItem)
    .filter((item): item is FmpEarningsCalendarItem => Boolean(item));
}

function normalizeTranscriptDateItem(raw: RawFmpRow, fallbackSymbol: string): FmpTranscriptDateItem | null {
  const date = pickString(raw, ['date']);
  if (!date) return null;
  return {
    symbol: (pickString(raw, ['symbol']) || fallbackSymbol).toUpperCase(),
    date,
    quarter: pickNumber(raw, ['quarter']),
    year: pickNumber(raw, ['year']),
  };
}

export async function getTranscriptDates(symbol: string, tokenOverride?: string): Promise<FmpTranscriptDateItem[]> {
  const safeSymbol = fmpHistorySymbol(symbol);
  const raw = await fmpGet<unknown>('/earning-call-transcript-dates', { symbol: safeSymbol }, 6 * 60 * 60 * 1000, tokenOverride);
  const rows = Array.isArray(raw)
    ? raw.map((item) => typeof item === 'string' ? { date: item } as RawFmpRow : item as RawFmpRow)
    : extractRawRows(raw);
  return rows
    .map((row) => normalizeTranscriptDateItem(row, safeSymbol))
    .filter((item): item is FmpTranscriptDateItem => Boolean(item))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function normalizeTranscriptItem(raw: RawFmpRow, fallbackSymbol: string, quarter?: number, year?: number): FmpTranscriptItem | null {
  const content = pickString(raw, ['content', 'transcript']);
  if (!content) return null;
  return {
    symbol: (pickString(raw, ['symbol']) || fallbackSymbol).toUpperCase(),
    date: pickString(raw, ['date']),
    quarter: pickNumber(raw, ['quarter']) ?? quarter,
    year: pickNumber(raw, ['year']) ?? year,
    title: pickString(raw, ['title']),
    content,
  };
}

export async function getEarningCallTranscript(
  symbol: string,
  quarter?: number,
  year?: number,
  tokenOverride?: string,
): Promise<FmpTranscriptItem | null> {
  const safeSymbol = fmpHistorySymbol(symbol);
  const raw = await fmpGet<unknown>(
    '/earning-call-transcript',
    {
      symbol: safeSymbol,
      ...(quarter ? { quarter } : {}),
      ...(year ? { year } : {}),
    },
    24 * 60 * 60 * 1000,
    tokenOverride,
  );
  const item = extractRawRows(raw)
    .map((row) => normalizeTranscriptItem(row, safeSymbol, quarter, year))
    .find(Boolean);
  return item || null;
}
