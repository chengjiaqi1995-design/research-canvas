import prisma from '../utils/db';
import { getPriceHistory, type EodhdPricePoint } from './eodhdService';

type TechnicalSignal = 'bullish' | 'neutral' | 'bearish';
type TechnicalTrend = 'uptrend' | 'sideways' | 'downtrend';

export interface PortfolioTechnicalWindowAnalysis {
  window: number;
  startDate: string;
  endDate: string;
  returnPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  latestClose: number;
  ma5?: number;
  ma20?: number;
  ma50?: number;
  closeVsMa5Pct?: number;
  closeVsMa20Pct?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  volumeRatio?: number;
  support?: number;
  resistance?: number;
  distanceToSupportPct?: number;
  distanceToResistancePct?: number;
  score: number;
  signal: TechnicalSignal;
  trend: TechnicalTrend;
  summary: string;
}

export interface PortfolioTechnicalAnalysisItem {
  positionId: number;
  tickerBbg: string;
  eodhdSymbol: string | null;
  nameEn: string;
  nameCn: string;
  longShort: string;
  positionAmount: number;
  positionWeight: number;
  latestDate?: string;
  latestClose?: number;
  overallScore?: number;
  overallSignal?: TechnicalSignal;
  combinedSummary?: string;
  keyObservations?: string[];
  windows: PortfolioTechnicalWindowAnalysis[];
  history: EodhdPricePoint[];
  error?: string;
}

export interface PortfolioTechnicalAnalysisResponse {
  generatedAt: string;
  scope: string;
  windows: number[];
  analyzedCount: number;
  skippedCount: number;
  items: PortfolioTechnicalAnalysisItem[];
}

type PositionInput = {
  id: number;
  tickerBbg: string;
  nameEn: string;
  nameCn: string;
  market: string;
  longShort: string;
  positionAmount: number;
  positionWeight: number;
};

function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function closeOf(point: EodhdPricePoint | undefined): number | undefined {
  return point?.adjustedClose ?? point?.close;
}

function sma(values: number[], period: number): Array<number | undefined> {
  const result: Array<number | undefined> = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

function ema(values: number[], period: number): Array<number | undefined> {
  const result: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length < period) return result;
  const multiplier = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] - prev) * multiplier + prev;
    result[i] = prev;
  }
  return result;
}

function rsi(values: number[], period = 14): Array<number | undefined> {
  const result: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length <= period) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine: Array<number | undefined> = values.map((_, index) => {
    const fastValue = fastEma[index];
    const slowValue = slowEma[index];
    return fastValue != null && slowValue != null ? fastValue - slowValue : undefined;
  });

  const compact = macdLine.filter((value): value is number => value != null);
  const compactSignal = ema(compact, signalPeriod);
  const signalLine: Array<number | undefined> = new Array(values.length).fill(undefined);
  let signalIndex = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) {
      signalLine[i] = compactSignal[signalIndex];
      signalIndex += 1;
    }
  }

  const histogram = macdLine.map((value, index) =>
    value != null && signalLine[index] != null ? value - signalLine[index]! : undefined,
  );
  return { macdLine, signalLine, histogram };
}

function maxDrawdownPct(values: number[]): number {
  let peak = values[0] || 0;
  let maxDrawdown = 0;
  values.forEach((value) => {
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
  });
  return maxDrawdown * 100;
}

function volatilityPct(values: number[]): number {
  if (values.length < 3) return 0;
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) returns.push(values[i] / values[i - 1] - 1);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function linearSlopePct(values: number[]): number {
  if (values.length < 2 || values[0] === 0) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += Math.pow(i - xMean, 2);
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return (slope * (n - 1) / values[0]) * 100;
}

function latestDefined<T>(values: Array<T | undefined>): T | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) return values[i];
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function signalFromScore(score: number): TechnicalSignal {
  if (score >= 25) return 'bullish';
  if (score <= -25) return 'bearish';
  return 'neutral';
}

function trendFrom(returnPct: number, slopePct: number, closeVsMa20Pct?: number): TechnicalTrend {
  const maBias = closeVsMa20Pct ?? 0;
  if (returnPct > 2 && slopePct > 1 && maBias > 0) return 'uptrend';
  if (returnPct < -2 && slopePct < -1 && maBias < 0) return 'downtrend';
  return 'sideways';
}

function formatPct(value: number | undefined, digits = 1) {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value.toFixed(digits)}%`;
}

function buildSummary(analysis: Omit<PortfolioTechnicalWindowAnalysis, 'summary'>): string {
  const direction = analysis.returnPct > 1 ? '上涨' : analysis.returnPct < -1 ? '下跌' : '震荡';
  const maText = analysis.closeVsMa5Pct != null
    ? `收盘价较MA5${analysis.closeVsMa5Pct >= 0 ? '高' : '低'}${formatPct(Math.abs(analysis.closeVsMa5Pct))}`
    : 'MA5数据不足';
  const rsiText = analysis.rsi14 == null
    ? 'RSI不足'
    : analysis.rsi14 >= 70
      ? `RSI ${analysis.rsi14.toFixed(0)}偏热`
      : analysis.rsi14 <= 30
        ? `RSI ${analysis.rsi14.toFixed(0)}偏冷`
        : `RSI ${analysis.rsi14.toFixed(0)}中性`;
  const macdText = analysis.macdHistogram == null
    ? 'MACD不足'
    : analysis.macdHistogram >= 0
      ? 'MACD动能为正'
      : 'MACD动能为负';
  return `${analysis.window}日${direction}${formatPct(analysis.returnPct)}，${maText}，最大回撤${formatPct(analysis.maxDrawdownPct)}，${rsiText}，${macdText}。`;
}

function analyzeWindow(
  history: EodhdPricePoint[],
  window: number,
  closes: number[],
  rsi14: Array<number | undefined>,
  macdData: ReturnType<typeof macd>,
): PortfolioTechnicalWindowAnalysis | null {
  if (history.length < Math.max(2, window)) return null;

  const latestIndex = history.length - 1;
  const startIndex = Math.max(0, history.length - window);
  const windowPoints = history.slice(startIndex);
  const windowCloses = windowPoints.map(closeOf).filter((value): value is number => value != null);
  if (windowCloses.length < Math.max(2, Math.min(window, 3))) return null;

  const latestPoint = history[latestIndex];
  const latestClose = closeOf(latestPoint);
  const startClose = windowCloses[0];
  if (latestClose == null || startClose == null || startClose === 0) return null;

  const latestMa5 = latestPoint.ma5 ?? latestDefined(sma(closes, 5));
  const latestMa20 = latestPoint.ma20 ?? latestDefined(sma(closes, 20));
  const latestMa50 = latestPoint.ma50 ?? latestDefined(sma(closes, 50));
  const latestRsi = rsi14[latestIndex];
  const latestMacd = macdData.macdLine[latestIndex];
  const latestMacdSignal = macdData.signalLine[latestIndex];
  const latestHistogram = macdData.histogram[latestIndex];

  const support = Math.min(...windowPoints.map((point) => point.low ?? closeOf(point) ?? Number.POSITIVE_INFINITY));
  const resistance = Math.max(...windowPoints.map((point) => point.high ?? closeOf(point) ?? Number.NEGATIVE_INFINITY));
  const avgVolume = windowPoints
    .map((point) => point.volume)
    .filter((value): value is number => value != null)
    .reduce((sum, value, _, arr) => sum + value / arr.length, 0);
  const latestVolume = latestPoint.volume;
  const volumeRatio = avgVolume && latestVolume ? latestVolume / avgVolume : undefined;

  const returnPct = (latestClose / startClose - 1) * 100;
  const drawdown = maxDrawdownPct(windowCloses);
  const volatility = volatilityPct(windowCloses);
  const slopePct = linearSlopePct(windowCloses);
  const closeVsMa5Pct = latestMa5 ? (latestClose / latestMa5 - 1) * 100 : undefined;
  const closeVsMa20Pct = latestMa20 ? (latestClose / latestMa20 - 1) * 100 : undefined;
  const distanceToSupportPct = support > 0 ? (latestClose / support - 1) * 100 : undefined;
  const distanceToResistancePct = resistance > 0 ? (latestClose / resistance - 1) * 100 : undefined;

  let score = 0;
  score += clamp(returnPct * 4, -24, 24);
  score += closeVsMa5Pct == null ? 0 : clamp(closeVsMa5Pct * 3, -18, 18);
  score += closeVsMa20Pct == null ? 0 : clamp(closeVsMa20Pct * 2, -18, 18);
  score += latestRsi == null ? 0 : latestRsi > 70 ? -10 : latestRsi < 30 ? -8 : latestRsi > 55 ? 8 : latestRsi < 45 ? -8 : 4;
  score += latestHistogram == null ? 0 : latestHistogram > 0 ? 10 : -10;
  score += volumeRatio == null ? 0 : returnPct > 0 && volumeRatio > 1.15 ? 6 : returnPct < 0 && volumeRatio > 1.15 ? -6 : 0;
  score += drawdown < -8 ? -8 : 0;
  score = Math.round(clamp(score, -100, 100));

  const base = {
    window,
    startDate: windowPoints[0].date,
    endDate: latestPoint.date,
    returnPct,
    maxDrawdownPct: drawdown,
    volatilityPct: volatility,
    latestClose,
    ma5: latestMa5,
    ma20: latestMa20,
    ma50: latestMa50,
    closeVsMa5Pct,
    closeVsMa20Pct,
    rsi14: latestRsi,
    macd: latestMacd,
    macdSignal: latestMacdSignal,
    macdHistogram: latestHistogram,
    volumeRatio,
    support: Number.isFinite(support) ? support : undefined,
    resistance: Number.isFinite(resistance) ? resistance : undefined,
    distanceToSupportPct,
    distanceToResistancePct,
    score,
    signal: signalFromScore(score),
    trend: trendFrom(returnPct, slopePct, closeVsMa20Pct),
  };

  return {
    ...base,
    summary: buildSummary(base),
  };
}

function bbgToEodhdSymbol(tickerBbg: string, market?: string): string | null {
  const cleaned = tickerBbg.replace(/\s+Equity$/i, '').trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/);
  const rawCode = parts[0]?.replace(/\//g, '-').toUpperCase();
  const suffix = (parts[1] || market || '').toUpperCase();
  if (!rawCode) return null;

  const directEodhd = rawCode.includes('.') ? rawCode : '';
  if (directEodhd) return directEodhd;

  if (suffix === 'US') return `${rawCode}.US`;
  if (suffix === 'HK') return `${rawCode}.HK`;
  if (suffix === 'CH' || suffix === 'CN') return `${rawCode}.${rawCode.startsWith('6') || rawCode.startsWith('9') ? 'SHG' : 'SHE'}`;
  if (suffix === 'SH' || suffix === 'SS' || suffix === 'SHG') return `${rawCode}.SHG`;
  if (suffix === 'SZ' || suffix === 'SHE') return `${rawCode}.SHE`;
  if (suffix === 'LN' || suffix === 'UK' || suffix === 'LSE') return `${rawCode}.LSE`;
  if (suffix === 'FP' || suffix === 'PA') return `${rawCode}.PA`;
  if (suffix === 'GR' || suffix === 'GY' || suffix === 'DE') return `${rawCode}.XETRA`;
  if (suffix === 'SW') return `${rawCode}.SW`;
  if (suffix === 'JP' || suffix === 'JT') return `${rawCode}.T`;
  if (suffix) return `${rawCode}.${suffix}`;
  return null;
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

function overallFrom(windows: PortfolioTechnicalWindowAnalysis[]) {
  if (!windows.length) return undefined;
  const weights: Record<number, number> = { 5: 0.25, 10: 0.3, 30: 0.45 };
  const totalWeight = windows.reduce((sum, item) => sum + (weights[item.window] || 0.2), 0);
  const score = windows.reduce((sum, item) => sum + item.score * (weights[item.window] || 0.2), 0) / (totalWeight || 1);
  return {
    score: Math.round(score),
    signal: signalFromScore(score),
  };
}

function buildCombinedSummary(windows: PortfolioTechnicalWindowAnalysis[]) {
  const w5 = windows.find((item) => item.window === 5);
  const w10 = windows.find((item) => item.window === 10);
  const w30 = windows.find((item) => item.window === 30);
  const overall = overallFrom(windows);
  if (!overall || !windows.length) {
    return {
      summary: '价格数据不足，无法形成综合技术面判断。',
      observations: ['有效窗口不足'],
    };
  }

  const returns = [w5, w10, w30]
    .filter((item): item is PortfolioTechnicalWindowAnalysis => Boolean(item))
    .map((item) => `${item.window}日${formatPct(item.returnPct)}`)
    .join(' / ');
  const shortTerm = w5 && w10
    ? (w5.returnPct > 0 && w10.returnPct > 0 ? '短线动量延续'
      : w5.returnPct < 0 && w10.returnPct < 0 ? '短线动量走弱'
        : '短线方向分歧')
    : '短线样本不足';
  const mediumTerm = w30
    ? (w30.returnPct > 3 ? '30日趋势偏强'
      : w30.returnPct < -3 ? '30日趋势偏弱'
        : '30日处于震荡区间')
    : '30日样本不足';
  const maBias = w10?.closeVsMa20Pct ?? w30?.closeVsMa20Pct;
  const maText = maBias == null
    ? '均线信息不足'
    : maBias >= 0
      ? `价格在MA20上方${formatPct(Math.abs(maBias))}`
      : `价格在MA20下方${formatPct(Math.abs(maBias))}`;
  const rsiValue = w10?.rsi14 ?? w30?.rsi14;
  const rsiText = rsiValue == null
    ? 'RSI不足'
    : rsiValue >= 70
      ? `RSI ${rsiValue.toFixed(0)}偏热`
      : rsiValue <= 30
        ? `RSI ${rsiValue.toFixed(0)}偏冷`
        : `RSI ${rsiValue.toFixed(0)}中性`;
  const macdHist = w10?.macdHistogram ?? w30?.macdHistogram;
  const macdText = macdHist == null
    ? 'MACD不足'
    : macdHist >= 0
      ? 'MACD动能为正'
      : 'MACD动能为负';
  const drawdown = Math.min(...windows.map((item) => item.maxDrawdownPct));
  const riskText = drawdown < -10 ? `近期回撤较深(${formatPct(drawdown)})` : `回撤可控(${formatPct(drawdown)})`;

  const signalText = SIGNAL_LABELS_CN[overall.signal];
  return {
    summary: `综合判断${signalText}，${returns}；${shortTerm}，${mediumTerm}，${maText}，${rsiText}，${macdText}，${riskText}。`,
    observations: [
      shortTerm,
      mediumTerm,
      maText,
      rsiText,
      macdText,
      riskText,
    ],
  };
}

const SIGNAL_LABELS_CN: Record<TechnicalSignal, string> = {
  bullish: '偏强',
  neutral: '中性',
  bearish: '偏弱',
};

async function analyzePosition(
  position: PositionInput,
  windows: number[],
): Promise<PortfolioTechnicalAnalysisItem> {
  const eodhdSymbol = bbgToEodhdSymbol(position.tickerBbg, position.market);
  if (!eodhdSymbol) {
    return {
      positionId: position.id,
      tickerBbg: position.tickerBbg,
      eodhdSymbol: null,
      nameEn: position.nameEn,
      nameCn: position.nameCn,
      longShort: position.longShort,
      positionAmount: position.positionAmount,
      positionWeight: position.positionWeight,
      windows: [],
      history: [],
      error: '无法映射到 EODHD symbol',
    };
  }

  try {
    const history = await getPriceHistory(eodhdSymbol, 140);
    const closes = history.map(closeOf).filter((value): value is number => value != null);
    if (history.length < 8 || closes.length < 8) {
      throw new Error('价格历史不足');
    }

    const rsi14 = rsi(closes, 14);
    const macdData = macd(closes);
    const analyses = windows
      .map((window) => analyzeWindow(history, window, closes, rsi14, macdData))
      .filter((item): item is PortfolioTechnicalWindowAnalysis => Boolean(item));
    const overall = overallFrom(analyses);
    const combined = buildCombinedSummary(analyses);
    const latest = history[history.length - 1];

    return {
      positionId: position.id,
      tickerBbg: position.tickerBbg,
      eodhdSymbol,
      nameEn: position.nameEn,
      nameCn: position.nameCn,
      longShort: position.longShort,
      positionAmount: position.positionAmount,
      positionWeight: position.positionWeight,
      latestDate: latest?.date,
      latestClose: closeOf(latest),
      overallScore: overall?.score,
      overallSignal: overall?.signal,
      combinedSummary: combined.summary,
      keyObservations: combined.observations,
      windows: analyses,
      history: history.slice(-90),
    };
  } catch (error) {
    return {
      positionId: position.id,
      tickerBbg: position.tickerBbg,
      eodhdSymbol,
      nameEn: position.nameEn,
      nameCn: position.nameCn,
      longShort: position.longShort,
      positionAmount: position.positionAmount,
      positionWeight: position.positionWeight,
      windows: [],
      history: [],
      error: error instanceof Error ? error.message : '技术面分析失败',
    };
  }
}

function parseWindows(value: unknown): number[] {
  const input = typeof value === 'string' ? value.split(',') : [];
  const parsed = input.map((item) => Number(item)).filter((item) => [5, 10, 30].includes(item));
  return parsed.length ? Array.from(new Set(parsed)) : [5, 10, 30];
}

export async function analyzePortfolioTechnicals(
  userId: string,
  params?: { scope?: string; windows?: string; limit?: string | number },
): Promise<PortfolioTechnicalAnalysisResponse> {
  const scope = params?.scope || 'active';
  const windows = parseWindows(params?.windows);
  const limit = cleanNumber(params?.limit) || 200;
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
    orderBy: { positionAmount: 'desc' },
    take: Math.min(Math.max(limit, 1), 300),
  });

  const items = await mapWithConcurrency(positions, 5, (position) => analyzePosition(position, windows));

  return {
    generatedAt: new Date().toISOString(),
    scope,
    windows,
    analyzedCount: items.filter((item) => !item.error).length,
    skippedCount: items.filter((item) => item.error).length,
    items,
  };
}
