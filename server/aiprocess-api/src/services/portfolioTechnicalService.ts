import prisma from '../utils/db';
import { getPriceHistory, type EodhdPricePoint } from './eodhdService';
import { bbgToEodhdSymbolCandidates } from './eodhdSymbolMapper';
import { getPriceHistory as getFmpPriceHistory, hasFmpApiKey } from './fmpService';
import { bbgToFmpSymbolCandidates, fmpPreferredForMarket } from './fmpSymbolMapper';

type TechnicalSignal = 'bullish' | 'neutral' | 'bearish';
type TechnicalTrend = 'uptrend' | 'sideways' | 'downtrend';
type MarketDataProvider = 'eodhd' | 'fmp';
type MovingAverageTouchPeriod = 10 | 25 | 50 | 100;
type MovingAverageTouchStatus = 'touched' | 'crossed' | 'near';
type MovingAverageTouchDirection = 'above' | 'below' | 'at';

export interface MovingAverageTouchAlert {
  period: MovingAverageTouchPeriod;
  ma: number;
  close: number;
  distancePct: number;
  status: MovingAverageTouchStatus;
  direction: MovingAverageTouchDirection;
  message: string;
}

export interface PortfolioDonchianRange {
  window: number;
  low: number;
  high: number;
  lowDate?: string;
  highDate?: string;
  distanceToLowPct?: number;
  distanceToHighPct?: number;
}

export interface PortfolioPriceRangeZone {
  type: 'support' | 'resistance';
  lower: number;
  upper: number;
  midpoint: number;
  touches: number;
  score: number;
  distancePct?: number;
  lastTouchDate?: string;
  label: string;
}

export type PortfolioPriceChannelStrategy =
  | 'bollinger_20_2'
  | 'keltner_20_2atr'
  | 'atr_envelope_50'
  | 'rolling_percentile_252';

export type PortfolioPriceChannelSignal =
  | 'inside'
  | 'near_lower'
  | 'near_upper'
  | 'upper_breakout'
  | 'lower_breakdown';

export interface PortfolioPriceChannelRange {
  strategy: PortfolioPriceChannelStrategy;
  label: string;
  lower: number;
  upper: number;
  middle?: number;
  widthPct?: number;
  positionPct?: number;
  signal: PortfolioPriceChannelSignal;
  description: string;
}

export type PortfolioTrendChannelStrategy =
  | 'linear_regression_120'
  | 'pivot_trend_channel';

export interface PortfolioTrendChannelRange {
  strategy: PortfolioTrendChannelStrategy;
  label: string;
  startDate: string;
  endDate: string;
  lowerStart: number;
  lowerEnd: number;
  upperStart: number;
  upperEnd: number;
  middleStart?: number;
  middleEnd?: number;
  slopePct?: number;
  widthPct?: number;
  positionPct?: number;
  signal: PortfolioPriceChannelSignal;
  description: string;
}

export interface PortfolioRangeConsensus {
  lower: number;
  upper: number;
  midpoint: number;
  widthPct?: number;
  positionPct?: number;
  confidence: number;
  label: string;
}

export interface PortfolioPriceRangeAnalysis {
  startDate: string;
  endDate: string;
  pointCount: number;
  atr14?: number;
  donchian: PortfolioDonchianRange[];
  supportZones: PortfolioPriceRangeZone[];
  resistanceZones: PortfolioPriceRangeZone[];
  channels: PortfolioPriceChannelRange[];
  trendChannels: PortfolioTrendChannelRange[];
  consensus?: PortfolioRangeConsensus;
  summary: string;
}

export interface PortfolioTechnicalWindowAnalysis {
  window: number;
  startDate: string;
  endDate: string;
  returnPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  latestClose: number;
  ma10?: number;
  ma20?: number;
  ma50?: number;
  closeVsMa10Pct?: number;
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
  marketDataProvider?: MarketDataProvider;
  marketDataSymbol?: string | null;
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
  maTouchAlerts?: MovingAverageTouchAlert[];
  priceRange?: PortfolioPriceRangeAnalysis;
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

type MarketDataTokens = {
  eodhdToken?: string;
  fmpApiKey?: string;
};

const DEFAULT_TECHNICAL_HISTORY_DAYS = 1095;
const MAX_TECHNICAL_HISTORY_DAYS = 10000;
const MAX_TECHNICAL_HISTORY_RETURN_POINTS = 3000;

function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function technicalHistoryReturnPoints(days: number): number {
  if (days >= MAX_TECHNICAL_HISTORY_DAYS) return MAX_TECHNICAL_HISTORY_RETURN_POINTS;
  return Math.min(MAX_TECHNICAL_HISTORY_RETURN_POINTS, Math.ceil(days * 0.75) + 80);
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
  const maText = analysis.closeVsMa10Pct != null
    ? `收盘价较MA10${analysis.closeVsMa10Pct >= 0 ? '高' : '低'}${formatPct(Math.abs(analysis.closeVsMa10Pct))}`
    : 'MA10数据不足';
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

function directionFromDistance(distancePct: number): MovingAverageTouchDirection {
  if (Math.abs(distancePct) < 0.1) return 'at';
  return distancePct > 0 ? 'above' : 'below';
}

function movingAverageForPeriod(point: EodhdPricePoint | undefined, period: MovingAverageTouchPeriod) {
  if (!point) return undefined;
  if (period === 10) return point.ma10;
  if (period === 25) return point.ma25;
  if (period === 50) return point.ma50;
  return point.ma100;
}

function buildMaTouchMessage(
  period: MovingAverageTouchPeriod,
  status: MovingAverageTouchStatus,
  direction: MovingAverageTouchDirection,
  distancePct: number,
) {
  if (status === 'crossed') {
    return `${direction === 'above' ? '上穿' : '下破'}MA${period}，收盘${direction === 'above' ? '高于' : '低于'}${formatPct(Math.abs(distancePct))}`;
  }
  if (status === 'touched') {
    const relation = direction === 'at' ? '贴近' : direction === 'above' ? '上方' : '下方';
    return `日内触碰MA${period}，收盘在${relation}${formatPct(Math.abs(distancePct))}`;
  }
  return `接近MA${period}，距离${formatPct(Math.abs(distancePct))}`;
}

function movingAverageTouchAlerts(history: EodhdPricePoint[]): MovingAverageTouchAlert[] {
  if (history.length < 2) return [];

  const latestIndex = history.length - 1;
  const latestPoint = history[latestIndex];
  const previousPoint = history[latestIndex - 1];
  const latestClose = closeOf(latestPoint);
  const previousClose = closeOf(previousPoint);
  if (latestClose == null || latestClose <= 0) return [];

  const latestHigh = latestPoint.high ?? latestClose;
  const latestLow = latestPoint.low ?? latestClose;

  return ([10, 25, 50, 100] as MovingAverageTouchPeriod[])
    .map((period) => {
      const ma = movingAverageForPeriod(latestPoint, period);
      const previousMa = movingAverageForPeriod(previousPoint, period);
      if (ma == null || ma <= 0) return null;

      const distancePct = (latestClose / ma - 1) * 100;
      const direction = directionFromDistance(distancePct);
      const touched = latestLow <= ma && latestHigh >= ma;
      const crossed = previousClose != null && previousMa != null
        && ((previousClose < previousMa && latestClose >= ma) || (previousClose > previousMa && latestClose <= ma));
      const near = Math.abs(distancePct) <= 1;
      if (!touched && !crossed && !near) return null;

      const status: MovingAverageTouchStatus = crossed ? 'crossed' : touched ? 'touched' : 'near';
      return {
        period,
        ma,
        close: latestClose,
        distancePct,
        status,
        direction,
        message: buildMaTouchMessage(period, status, direction, distancePct),
      };
    })
    .filter((alert): alert is MovingAverageTouchAlert => Boolean(alert))
    .sort((a, b) => {
      const statusRank: Record<MovingAverageTouchStatus, number> = { crossed: 0, touched: 1, near: 2 };
      return statusRank[a.status] - statusRank[b.status] || Math.abs(a.distancePct) - Math.abs(b.distancePct);
    });
}

type NormalizedTechnicalPricePoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type SwingLevel = {
  price: number;
  date: string;
  weight: number;
};

type SwingPivot = {
  index: number;
  price: number;
  date: string;
};

function normalizeAdjustedPricePoint(point: EodhdPricePoint): NormalizedTechnicalPricePoint | null {
  const rawClose = point.close ?? point.adjustedClose;
  const close = closeOf(point);
  if (rawClose == null || close == null || close <= 0) return null;
  const adjustmentRatio = point.adjustedClose != null && point.close ? point.adjustedClose / point.close : 1;
  const adjust = (value: number | undefined) => (value == null ? undefined : value * adjustmentRatio);
  const open = adjust(point.open) ?? close;
  const high = Math.max(adjust(point.high) ?? close, open, close);
  const low = Math.min(adjust(point.low) ?? close, open, close);
  return {
    date: point.date,
    open,
    high,
    low,
    close,
    volume: point.volume,
  };
}

function averageTrueRange(points: NormalizedTechnicalPricePoint[], period = 14): number | undefined {
  if (points.length < 2) return undefined;
  const trueRanges: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const previousClose = points[i - 1].close;
    trueRanges.push(Math.max(
      point.high - point.low,
      Math.abs(point.high - previousClose),
      Math.abs(point.low - previousClose),
    ));
  }
  const slice = trueRanges.slice(-period);
  if (!slice.length) return undefined;
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

function donchianRanges(points: NormalizedTechnicalPricePoint[], latestClose: number): PortfolioDonchianRange[] {
  return [20, 55, 120, 252]
    .filter((window) => points.length >= Math.min(window, 20))
    .map((window) => {
      const slice = points.slice(-Math.min(window, points.length));
      const highPoint = slice.reduce((best, point) => (point.high > best.high ? point : best), slice[0]);
      const lowPoint = slice.reduce((best, point) => (point.low < best.low ? point : best), slice[0]);
      return {
        window,
        low: lowPoint.low,
        high: highPoint.high,
        lowDate: lowPoint.date,
        highDate: highPoint.date,
        distanceToLowPct: lowPoint.low > 0 ? (latestClose / lowPoint.low - 1) * 100 : undefined,
        distanceToHighPct: latestClose > 0 ? (highPoint.high / latestClose - 1) * 100 : undefined,
      };
    });
}

function findSwingLevels(
  points: NormalizedTechnicalPricePoint[],
  type: 'support' | 'resistance',
  radius = 4,
): SwingLevel[] {
  if (points.length < radius * 2 + 1) return [];
  const levels: SwingLevel[] = [];
  for (let i = radius; i < points.length - radius; i++) {
    const window = points.slice(i - radius, i + radius + 1);
    const point = points[i];
    const price = type === 'support' ? point.low : point.high;
    const extreme = type === 'support'
      ? Math.min(...window.map((item) => item.low))
      : Math.max(...window.map((item) => item.high));
    if (Math.abs(price - extreme) < Math.max(price * 0.0001, 0.000001)) {
      const volumeBoost = point.volume ? 1.15 : 1;
      levels.push({ price, date: point.date, weight: volumeBoost });
    }
  }
  return levels;
}

function findSwingPivots(
  points: NormalizedTechnicalPricePoint[],
  type: 'support' | 'resistance',
  radius = 4,
): SwingPivot[] {
  if (points.length < radius * 2 + 1) return [];
  const pivots: SwingPivot[] = [];
  for (let i = radius; i < points.length - radius; i++) {
    const window = points.slice(i - radius, i + radius + 1);
    const point = points[i];
    const price = type === 'support' ? point.low : point.high;
    const extreme = type === 'support'
      ? Math.min(...window.map((item) => item.low))
      : Math.max(...window.map((item) => item.high));
    if (Math.abs(price - extreme) < Math.max(price * 0.0001, 0.000001)) {
      pivots.push({ index: i, price, date: point.date });
    }
  }
  return pivots;
}

function formatPriceForRange(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const avg = average(values);
  if (avg == null) return undefined;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values: number[], pct: number): number | undefined {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const index = clamp(pct, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values: number[]): number | undefined {
  return percentile(values, 0.5);
}

function priceChannelSignal(latestClose: number, lower: number, upper: number): PortfolioPriceChannelSignal {
  if (latestClose > upper) return 'upper_breakout';
  if (latestClose < lower) return 'lower_breakdown';
  const width = upper - lower;
  if (width <= 0) return 'inside';
  const positionPct = ((latestClose - lower) / width) * 100;
  if (positionPct >= 85) return 'near_upper';
  if (positionPct <= 15) return 'near_lower';
  return 'inside';
}

function buildChannelRange(
  strategy: PortfolioPriceChannelStrategy,
  label: string,
  lower: number | undefined,
  upper: number | undefined,
  latestClose: number,
  description: string,
  middle?: number,
): PortfolioPriceChannelRange | null {
  if (lower == null || upper == null || !Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper <= lower) {
    return null;
  }
  const widthPct = middle && middle > 0 ? ((upper - lower) / middle) * 100 : undefined;
  const positionPct = clamp(((latestClose - lower) / (upper - lower)) * 100, 0, 100);
  return {
    strategy,
    label,
    lower,
    upper,
    middle,
    widthPct,
    positionPct,
    signal: priceChannelSignal(latestClose, lower, upper),
    description,
  };
}

function buildPriceChannels(
  points: NormalizedTechnicalPricePoint[],
  latestClose: number,
  atr14?: number,
): PortfolioPriceChannelRange[] {
  const closes = points.map((point) => point.close);
  const channels: PortfolioPriceChannelRange[] = [];

  const last20Closes = closes.slice(-20);
  const bollingerMiddle = last20Closes.length >= 20 ? average(last20Closes) : undefined;
  const bollingerDev = last20Closes.length >= 20 ? standardDeviation(last20Closes) : undefined;
  const bollinger = buildChannelRange(
    'bollinger_20_2',
    'Bollinger 20/2',
    bollingerMiddle != null && bollingerDev != null ? bollingerMiddle - bollingerDev * 2 : undefined,
    bollingerMiddle != null && bollingerDev != null ? bollingerMiddle + bollingerDev * 2 : undefined,
    latestClose,
    '20日均线加减2倍标准差，用来观察波动区间和突破/回归位置。',
    bollingerMiddle,
  );
  if (bollinger) channels.push(bollinger);

  const ema20 = latestDefined(ema(closes, 20));
  const atr20 = averageTrueRange(points, 20);
  const keltner = buildChannelRange(
    'keltner_20_2atr',
    'Keltner 20/2ATR',
    ema20 != null && atr20 != null ? ema20 - atr20 * 2 : undefined,
    ema20 != null && atr20 != null ? ema20 + atr20 * 2 : undefined,
    latestClose,
    '20日EMA加减2倍ATR，给出随波动率调整的运行通道。',
    ema20,
  );
  if (keltner) channels.push(keltner);

  const ma50 = latestDefined(sma(closes, 50));
  const atrEnvelope = buildChannelRange(
    'atr_envelope_50',
    'MA50 ATR Envelope',
    ma50 != null && atr14 != null ? ma50 - atr14 * 2 : undefined,
    ma50 != null && atr14 != null ? ma50 + atr14 * 2 : undefined,
    latestClose,
    '50日均线加减2倍ATR，用中期均值和波动率估计常态运行带。',
    ma50,
  );
  if (atrEnvelope) channels.push(atrEnvelope);

  const percentileWindow = points.slice(-Math.min(252, points.length));
  const percentileBand = percentileWindow.length >= 60
    ? buildChannelRange(
      'rolling_percentile_252',
      `${Math.min(252, percentileWindow.length)}D 10/90分位`,
      percentile(percentileWindow.map((point) => point.low), 0.1),
      percentile(percentileWindow.map((point) => point.high), 0.9),
      latestClose,
      '用近一年或可用样本的10/90分位过滤极端值，得到更稳健的历史运行区间。',
      median(percentileWindow.map((point) => point.close)),
    )
    : null;
  if (percentileBand) channels.push(percentileBand);

  return channels;
}

function linearRegression(points: Array<{ index: number; value: number }>): { slope: number; intercept: number } | undefined {
  if (points.length < 2) return undefined;
  const xMean = points.reduce((sum, point) => sum + point.index, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  points.forEach((point) => {
    numerator += (point.index - xMean) * (point.value - yMean);
    denominator += Math.pow(point.index - xMean, 2);
  });
  if (denominator === 0) return undefined;
  const slope = numerator / denominator;
  return {
    slope,
    intercept: yMean - slope * xMean,
  };
}

function channelSignalAtEnd(latestClose: number, lowerEnd: number, upperEnd: number): PortfolioPriceChannelSignal {
  return priceChannelSignal(latestClose, lowerEnd, upperEnd);
}

function buildTrendChannelRange(
  strategy: PortfolioTrendChannelStrategy,
  label: string,
  startDate: string,
  endDate: string,
  lowerStart: number,
  lowerEnd: number,
  upperStart: number,
  upperEnd: number,
  latestClose: number,
  description: string,
  middleStart?: number,
  middleEnd?: number,
): PortfolioTrendChannelRange | null {
  if (
    !Number.isFinite(lowerStart) ||
    !Number.isFinite(lowerEnd) ||
    !Number.isFinite(upperStart) ||
    !Number.isFinite(upperEnd) ||
    lowerStart <= 0 ||
    lowerEnd <= 0 ||
    upperStart <= lowerStart ||
    upperEnd <= lowerEnd
  ) {
    return null;
  }
  const widthEnd = upperEnd - lowerEnd;
  const midpointEnd = (upperEnd + lowerEnd) / 2;
  const positionPct = clamp(((latestClose - lowerEnd) / widthEnd) * 100, 0, 100);
  const slopePct = middleStart && middleEnd && middleStart > 0 ? (middleEnd / middleStart - 1) * 100 : undefined;
  return {
    strategy,
    label,
    startDate,
    endDate,
    lowerStart,
    lowerEnd,
    upperStart,
    upperEnd,
    middleStart,
    middleEnd,
    slopePct,
    widthPct: midpointEnd > 0 ? (widthEnd / midpointEnd) * 100 : undefined,
    positionPct,
    signal: channelSignalAtEnd(latestClose, lowerEnd, upperEnd),
    description,
  };
}

function buildLinearRegressionChannel(points: NormalizedTechnicalPricePoint[], latestClose: number): PortfolioTrendChannelRange | null {
  const sample = points.slice(-Math.min(120, points.length));
  if (sample.length < 40) return null;
  const regression = linearRegression(sample.map((point, index) => ({ index, value: point.close })));
  if (!regression) return null;
  const fitted = (index: number) => regression.intercept + regression.slope * index;
  const maxDistance = Math.max(
    ...sample.map((point, index) => Math.max(Math.abs(point.high - fitted(index)), Math.abs(point.low - fitted(index)))),
  );
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return null;
  const startIndex = 0;
  const endIndex = sample.length - 1;
  const middleStart = fitted(startIndex);
  const middleEnd = fitted(endIndex);
  return buildTrendChannelRange(
    'linear_regression_120',
    `${sample.length}D 回归通道`,
    sample[startIndex].date,
    sample[endIndex].date,
    middleStart - maxDistance,
    middleEnd - maxDistance,
    middleStart + maxDistance,
    middleEnd + maxDistance,
    latestClose,
    '线性回归中轴加减最大高低点偏离，类似 Raff/Linear Regression Channel，用来识别斜率趋势内的运行区间。',
    middleStart,
    middleEnd,
  );
}

function buildPivotTrendChannel(points: NormalizedTechnicalPricePoint[], latestClose: number): PortfolioTrendChannelRange | null {
  const sample = points.slice(-Math.min(180, points.length));
  if (sample.length < 50) return null;
  const highs = findSwingPivots(sample, 'resistance', 4).slice(-6);
  const lows = findSwingPivots(sample, 'support', 4).slice(-6);
  if (highs.length < 2 || lows.length < 2) return null;

  const highRegression = linearRegression(highs.map((pivot) => ({ index: pivot.index, value: pivot.price })));
  const lowRegression = linearRegression(lows.map((pivot) => ({ index: pivot.index, value: pivot.price })));
  if (!highRegression || !lowRegression) return null;
  const slope = (highRegression.slope + lowRegression.slope) / 2;
  const upperIntercept = Math.max(...highs.map((pivot) => pivot.price - slope * pivot.index));
  const lowerIntercept = Math.min(...lows.map((pivot) => pivot.price - slope * pivot.index));
  const startIndex = Math.max(0, Math.min(highs[0].index, lows[0].index) - 2);
  const endIndex = sample.length - 1;
  const upperAt = (index: number) => upperIntercept + slope * index;
  const lowerAt = (index: number) => lowerIntercept + slope * index;
  const middleAt = (index: number) => (upperAt(index) + lowerAt(index)) / 2;
  return buildTrendChannelRange(
    'pivot_trend_channel',
    'Pivot 趋势通道',
    sample[startIndex].date,
    sample[endIndex].date,
    lowerAt(startIndex),
    lowerAt(endIndex),
    upperAt(startIndex),
    upperAt(endIndex),
    latestClose,
    '用最近 swing high / swing low 枢轴拟合平行趋势通道，适合看图形里的斜向支撑和斜向压力。',
    middleAt(startIndex),
    middleAt(endIndex),
  );
}

function buildTrendChannels(
  points: NormalizedTechnicalPricePoint[],
  latestClose: number,
): PortfolioTrendChannelRange[] {
  return [
    buildLinearRegressionChannel(points, latestClose),
    buildPivotTrendChannel(points, latestClose),
  ].filter((channel): channel is PortfolioTrendChannelRange => Boolean(channel));
}

function buildConsensusRange(
  latestClose: number,
  donchian: PortfolioDonchianRange[],
  supportZones: PortfolioPriceRangeZone[],
  resistanceZones: PortfolioPriceRangeZone[],
  channels: PortfolioPriceChannelRange[],
): PortfolioRangeConsensus | undefined {
  const lowerCandidates = [
    donchian.find((range) => range.window === 55)?.low,
    donchian.find((range) => range.window === 120)?.low,
    supportZones[0]?.midpoint,
    supportZones[1]?.midpoint,
    ...channels.map((channel) => channel.lower),
  ].filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const upperCandidates = [
    donchian.find((range) => range.window === 55)?.high,
    donchian.find((range) => range.window === 120)?.high,
    resistanceZones[0]?.midpoint,
    resistanceZones[1]?.midpoint,
    ...channels.map((channel) => channel.upper),
  ].filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  const lower = median(lowerCandidates);
  const upper = median(upperCandidates);
  if (lower == null || upper == null || upper <= lower) return undefined;
  const midpoint = (lower + upper) / 2;
  const widthPct = midpoint > 0 ? ((upper - lower) / midpoint) * 100 : undefined;
  const positionPct = clamp(((latestClose - lower) / (upper - lower)) * 100, 0, 100);
  const evidenceCount = lowerCandidates.length + upperCandidates.length;
  const confidence = Math.round(clamp(35 + evidenceCount * 5 + Math.min(channels.length, 4) * 4, 40, 92));
  return {
    lower,
    upper,
    midpoint,
    widthPct,
    positionPct,
    confidence,
    label: `共识运行区间 ${formatPriceForRange(lower)}-${formatPriceForRange(upper)}，当前位置约 ${positionPct.toFixed(0)}%。`,
  };
}

function clusterPriceZones(
  levels: SwingLevel[],
  type: 'support' | 'resistance',
  latestClose: number,
  atr14?: number,
): PortfolioPriceRangeZone[] {
  if (!levels.length || latestClose <= 0) return [];
  const fallbackAtr = latestClose * 0.02;
  const atr = atr14 && atr14 > 0 ? atr14 : fallbackAtr;
  const clusterGap = Math.max(atr * 0.75, latestClose * 0.012);
  const zonePadding = Math.max(atr * 0.25, latestClose * 0.003);
  const now = Date.now();
  const filtered = levels
    .filter((level) => level.price > 0)
    .filter((level) => type === 'support'
      ? level.price <= latestClose * 1.02
      : level.price >= latestClose * 0.98)
    .sort((a, b) => a.price - b.price);

  type Cluster = {
    lower: number;
    upper: number;
    weightedSum: number;
    weight: number;
    touches: number;
    lastTouchDate?: string;
  };
  const clusters: Cluster[] = [];
  for (const level of filtered) {
    const last = clusters[clusters.length - 1];
    if (last && level.price <= last.upper + clusterGap) {
      last.lower = Math.min(last.lower, level.price);
      last.upper = Math.max(last.upper, level.price);
      last.weightedSum += level.price * level.weight;
      last.weight += level.weight;
      last.touches += 1;
      if (!last.lastTouchDate || level.date > last.lastTouchDate) last.lastTouchDate = level.date;
    } else {
      clusters.push({
        lower: level.price,
        upper: level.price,
        weightedSum: level.price * level.weight,
        weight: level.weight,
        touches: 1,
        lastTouchDate: level.date,
      });
    }
  }

  return clusters
    .map((cluster): PortfolioPriceRangeZone | null => {
      const midpoint = cluster.weightedSum / cluster.weight;
      const lower = Math.max(0, cluster.lower - zonePadding);
      const upper = cluster.upper + zonePadding;
      if (type === 'support' && lower > latestClose * 1.02) return null;
      if (type === 'resistance' && upper < latestClose * 0.98) return null;

      const distancePct = type === 'support'
        ? (latestClose / Math.max(upper, 0.000001) - 1) * 100
        : (lower / latestClose - 1) * 100;
      const touchedAt = cluster.lastTouchDate ? Date.parse(cluster.lastTouchDate) : NaN;
      const ageDays = Number.isFinite(touchedAt) ? Math.max(0, (now - touchedAt) / 86_400_000) : 365;
      const recencyScore = clamp(22 - ageDays / 18, 0, 22);
      const closenessScore = clamp(24 - Math.abs(distancePct) * 1.8, 0, 24);
      const score = Math.round(cluster.weight * 10 + recencyScore + closenessScore);
      const label = `${type === 'support' ? '支撑' : '压力'} ${formatPriceForRange(lower)}-${formatPriceForRange(upper)} · ${cluster.touches}次`;
      return {
        type,
        lower,
        upper,
        midpoint,
        touches: cluster.touches,
        score,
        distancePct,
        lastTouchDate: cluster.lastTouchDate,
        label,
      };
    })
    .filter((zone): zone is PortfolioPriceRangeZone => Boolean(zone))
    .sort((a, b) => Math.abs(a.distancePct ?? 999) - Math.abs(b.distancePct ?? 999) || b.score - a.score)
    .slice(0, 4);
}

function buildPriceRangeAnalysis(history: EodhdPricePoint[]): PortfolioPriceRangeAnalysis | undefined {
  const points = history
    .map(normalizeAdjustedPricePoint)
    .filter((point): point is NormalizedTechnicalPricePoint => Boolean(point));
  if (points.length < 20) return undefined;

  const latest = points[points.length - 1];
  const atr14 = averageTrueRange(points, 14);
  const donchian = donchianRanges(points, latest.close);
  const supportLevels = findSwingLevels(points, 'support');
  const resistanceLevels = findSwingLevels(points, 'resistance');
  donchian.forEach((range) => {
    supportLevels.push({ price: range.low, date: range.lowDate || latest.date, weight: 2 });
    resistanceLevels.push({ price: range.high, date: range.highDate || latest.date, weight: 2 });
  });

  const supportZones = clusterPriceZones(supportLevels, 'support', latest.close, atr14);
  const resistanceZones = clusterPriceZones(resistanceLevels, 'resistance', latest.close, atr14);
  const channels = buildPriceChannels(points, latest.close, atr14);
  const trendChannels = buildTrendChannels(points, latest.close);
  const consensus = buildConsensusRange(latest.close, donchian, supportZones, resistanceZones, channels);
  const referenceRange = donchian.find((range) => range.window === 55) || donchian[0];
  const support = supportZones[0];
  const resistance = resistanceZones[0];
  const summaryParts: string[] = [];
  if (consensus) {
    summaryParts.push(consensus.label);
  }
  if (referenceRange) {
    summaryParts.push(`${referenceRange.window}D Donchian 区间 ${formatPriceForRange(referenceRange.low)}-${formatPriceForRange(referenceRange.high)}`);
  }
  if (trendChannels[0]) {
    summaryParts.push(`${trendChannels[0].label} ${formatPriceForRange(trendChannels[0].lowerEnd)}-${formatPriceForRange(trendChannels[0].upperEnd)}，斜率${formatPct(trendChannels[0].slopePct)}`);
  }
  if (support) {
    summaryParts.push(`最近支撑 ${formatPriceForRange(support.lower)}-${formatPriceForRange(support.upper)}，距离${formatPct(Math.max(support.distancePct ?? 0, 0))}`);
  }
  if (resistance) {
    summaryParts.push(`最近压力 ${formatPriceForRange(resistance.lower)}-${formatPriceForRange(resistance.upper)}，距离${formatPct(Math.max(resistance.distancePct ?? 0, 0))}`);
  }

  return {
    startDate: points[0].date,
    endDate: latest.date,
    pointCount: points.length,
    atr14,
    donchian,
    supportZones,
    resistanceZones,
    channels,
    trendChannels,
    consensus,
    summary: summaryParts.length ? summaryParts.join('；') + '。' : '价格区间数据不足。',
  };
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

  const latestMa10 = latestPoint.ma10 ?? latestDefined(sma(closes, 10));
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
  const closeVsMa10Pct = latestMa10 ? (latestClose / latestMa10 - 1) * 100 : undefined;
  const closeVsMa20Pct = latestMa20 ? (latestClose / latestMa20 - 1) * 100 : undefined;
  const distanceToSupportPct = support > 0 ? (latestClose / support - 1) * 100 : undefined;
  const distanceToResistancePct = resistance > 0 ? (latestClose / resistance - 1) * 100 : undefined;

  let score = 0;
  score += clamp(returnPct * 4, -24, 24);
  score += closeVsMa10Pct == null ? 0 : clamp(closeVsMa10Pct * 3, -18, 18);
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
    ma10: latestMa10,
    ma20: latestMa20,
    ma50: latestMa50,
    closeVsMa10Pct,
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

function isRetryableSymbolError(error: unknown): boolean {
  const status = (error as any)?.status;
  const message = error instanceof Error ? error.message : String(error || '');
  if (/EODHD_API_TOKEN|FMP_API_KEY|subscription|exceeded your daily API requests limit|rate limit|forbidden|unauthorized|invalid api key/i.test(message)) {
    return false;
  }
  if (status != null && ![400, 404].includes(Number(status))) return false;
  return /ticker not found|symbol not found|not found|no data|价格历史不足/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '技术面分析失败');
}

async function getUsableProviderPriceHistory(
  provider: MarketDataProvider,
  candidates: string[],
  days: number,
  tokens?: MarketDataTokens,
): Promise<{ provider: MarketDataProvider; symbol: string; history: EodhdPricePoint[] }> {
  let lastError: unknown;
  for (const symbol of candidates) {
    try {
      const history = provider === 'fmp'
        ? await getFmpPriceHistory(symbol, days, tokens?.fmpApiKey)
        : await getPriceHistory(symbol, days, tokens?.eodhdToken);
      const closes = history.map(closeOf).filter((value): value is number => value != null);
      if (history.length >= 8 && closes.length >= 8) return { provider, symbol, history };
      lastError = new Error(`价格历史不足；symbol=${symbol}；返回 ${history.length} 条`);
    } catch (error) {
      lastError = error;
      if (!isRetryableSymbolError(error)) break;
    }
  }

  const message = errorMessage(lastError);
  const suffix = candidates.length > 1 && isRetryableSymbolError(lastError)
    ? `；已尝试 ${candidates.join(', ')}`
    : '';
  throw new Error(`${message}${suffix}`);
}

function providerLabel(provider: MarketDataProvider): string {
  return provider === 'fmp' ? 'FMP' : 'EODHD';
}

async function getUsableMarketPriceHistory(
  position: PositionInput,
  days: number,
  tokens?: MarketDataTokens,
): Promise<{
  provider: MarketDataProvider;
  symbol: string;
  history: EodhdPricePoint[];
  initialSymbol: string | null;
}> {
  const eodhdCandidates = bbgToEodhdSymbolCandidates(position.tickerBbg, position.market);
  const fmpCandidates = bbgToFmpSymbolCandidates(position.tickerBbg, position.market);
  const preferFmp = fmpPreferredForMarket(position.tickerBbg, position.market);
  const attempts: Array<{ provider: MarketDataProvider; candidates: string[] }> = [];

  if (preferFmp && fmpCandidates.length) attempts.push({ provider: 'fmp', candidates: fmpCandidates });
  if (eodhdCandidates.length) attempts.push({ provider: 'eodhd', candidates: eodhdCandidates });
  if (!preferFmp && fmpCandidates.length && hasFmpApiKey(tokens?.fmpApiKey)) {
    attempts.push({ provider: 'fmp', candidates: fmpCandidates });
  }

  const initialSymbol = attempts[0]?.candidates[0] || eodhdCandidates[0] || fmpCandidates[0] || null;
  if (!attempts.length || !initialSymbol) {
    throw new Error('无法映射到市场数据 symbol');
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await getUsableProviderPriceHistory(attempt.provider, attempt.candidates, days, tokens);
      return { ...result, initialSymbol };
    } catch (error) {
      errors.push(`${providerLabel(attempt.provider)}: ${errorMessage(error)}`);
    }
  }

  throw new Error(errors.join('；') || '价格历史不足');
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

function buildCombinedSummary(windows: PortfolioTechnicalWindowAnalysis[], maAlerts: MovingAverageTouchAlert[]) {
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
  const maTouchText = maAlerts.length
    ? `关键均线：${maAlerts.map((alert) => alert.message).join('；')}`
    : '关键均线暂无触碰信号';
  const drawdown = Math.min(...windows.map((item) => item.maxDrawdownPct));
  const riskText = drawdown < -10 ? `近期回撤较深(${formatPct(drawdown)})` : `回撤可控(${formatPct(drawdown)})`;

  const signalText = SIGNAL_LABELS_CN[overall.signal];
  return {
    summary: `综合判断${signalText}，${returns}；${shortTerm}，${mediumTerm}，${maText}，${maTouchText}，${rsiText}，${macdText}，${riskText}。`,
    observations: [
      shortTerm,
      mediumTerm,
      maText,
      ...maAlerts.slice(0, 3).map((alert) => alert.message),
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
  days: number,
  historyReturnPoints: number,
  tokens?: MarketDataTokens,
): Promise<PortfolioTechnicalAnalysisItem> {
  const eodhdSymbolCandidates = bbgToEodhdSymbolCandidates(position.tickerBbg, position.market);
  const fmpSymbolCandidates = bbgToFmpSymbolCandidates(position.tickerBbg, position.market);
  const preferFmp = fmpPreferredForMarket(position.tickerBbg, position.market);
  const initialMarketDataSymbol = (preferFmp ? fmpSymbolCandidates[0] : eodhdSymbolCandidates[0])
    || eodhdSymbolCandidates[0]
    || fmpSymbolCandidates[0]
    || null;
  if (!initialMarketDataSymbol) {
    return {
      positionId: position.id,
      tickerBbg: position.tickerBbg,
      eodhdSymbol: null,
      marketDataSymbol: null,
      nameEn: position.nameEn,
      nameCn: position.nameCn,
      longShort: position.longShort,
      positionAmount: position.positionAmount,
      positionWeight: position.positionWeight,
      windows: [],
      history: [],
      error: '无法映射到市场数据 symbol',
    };
  }

  try {
    const { provider, symbol: marketDataSymbol, history } = await getUsableMarketPriceHistory(position, days, tokens);
    const closes = history.map(closeOf).filter((value): value is number => value != null);

    const rsi14 = rsi(closes, 14);
    const macdData = macd(closes);
    const analyses = windows
      .map((window) => analyzeWindow(history, window, closes, rsi14, macdData))
      .filter((item): item is PortfolioTechnicalWindowAnalysis => Boolean(item));
    const overall = overallFrom(analyses);
    const maAlerts = movingAverageTouchAlerts(history);
    const priceRange = buildPriceRangeAnalysis(history);
    const combined = buildCombinedSummary(analyses, maAlerts);
    const latest = history[history.length - 1];

    return {
      positionId: position.id,
      tickerBbg: position.tickerBbg,
      eodhdSymbol: marketDataSymbol,
      marketDataProvider: provider,
      marketDataSymbol,
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
      keyObservations: priceRange ? [...combined.observations, priceRange.summary] : combined.observations,
      maTouchAlerts: maAlerts,
      priceRange,
      windows: analyses,
      history: history.slice(-historyReturnPoints),
    };
  } catch (error) {
    return {
      positionId: position.id,
      tickerBbg: position.tickerBbg,
      eodhdSymbol: initialMarketDataSymbol,
      marketDataSymbol: initialMarketDataSymbol,
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
  params?: { scope?: string; windows?: string; limit?: string | number; days?: string | number },
  tokens?: MarketDataTokens,
): Promise<PortfolioTechnicalAnalysisResponse> {
  const scope = params?.scope || 'active';
  const windows = parseWindows(params?.windows);
  const limit = cleanNumber(params?.limit) || 200;
  const days = Math.min(Math.max(cleanNumber(params?.days) || DEFAULT_TECHNICAL_HISTORY_DAYS, 180), MAX_TECHNICAL_HISTORY_DAYS);
  const historyReturnPoints = technicalHistoryReturnPoints(days);
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

  const items = await mapWithConcurrency(positions, 5, (position) => analyzePosition(position, windows, days, historyReturnPoints, tokens));

  return {
    generatedAt: new Date().toISOString(),
    scope,
    windows,
    analyzedCount: items.filter((item) => !item.error).length,
    skippedCount: items.filter((item) => item.error).length,
    items,
  };
}
