// Portfolio Manager 类型定义

export interface TaxonomyItem {
  id: number;
  type: string;
  name: string;
  parentId: number | null;
  sortOrder: number;
  children?: TaxonomyItem[];
  parent?: TaxonomyItem | null;
}

export interface PositionWithRelations {
  id: number;
  tickerBbg: string;
  nameEn: string;
  nameCn: string;
  market: string;
  priority: string;
  longShort: string;
  marketCapLocal: number;
  marketCapRmb: number;
  profit2025: number;
  pe2026: number;
  pe2027: number;
  priceTag: string;
  positionAmount: number;
  positionWeight: number;
  sectorId: number | null;
  sectorName: string;
  themeId: number | null;
  topdownId: number | null;
  sector: TaxonomyItem | null;
  theme: TaxonomyItem | null;
  topdown: TaxonomyItem | null;
  gicIndustry?: string;
  exchangeCountry?: string;
  pnl?: number;
  return1d?: number | null;
  return1m?: number | null;
  return1y?: number | null;
  pricesUpdatedAt?: string | null;
}

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

export interface TradeItemInput {
  tickerBbg: string;
  name: string;
  transactionType: 'buy' | 'sell';
  gmvUsdK: number; // -1 means "all"
  unwind: boolean;
  reason: string;
}

export interface TradeWithItems {
  id: number;
  status: string;
  note: string;
  createdAt: string;
  executedAt: string | null;
  items: {
    id: number;
    tickerBbg: string;
    name: string;
    transactionType: string;
    gmvUsdK: number;
    unwind: boolean;
    reason: string;
  }[];
}

export interface PortfolioSettings {
  id: string;
  aum: number;
  aiProviders: string; // JSON string
}

export type PortfolioImpactDirection = 'positive' | 'negative' | 'neutral' | 'mixed';
export type PortfolioImpactStatus = 'new' | 'confirmed' | 'dismissed' | 'stale';
export type PortfolioImpactAlertStatus = 'open' | 'acknowledged' | 'dismissed' | 'resolved';
export type PortfolioImpactAlertSeverity = 'critical' | 'warning' | 'watch';

export interface PortfolioImpactAlert {
  id: string;
  severity: PortfolioImpactAlertSeverity;
  alertType: string;
  message: string;
  status: PortfolioImpactAlertStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioFeedImpact {
  id: string;
  userId: string;
  feedItemId: string;
  positionId: number;
  relevanceScore: number;
  fundamentalDirection: PortfolioImpactDirection;
  fundamentalScore: number;
  portfolioDirection: PortfolioImpactDirection;
  portfolioScore: number;
  horizon: string;
  channel: string;
  confidence: number;
  thesis: string;
  evidenceJson: string;
  evidence?: {
    feedTitle?: string;
    feedSource?: string;
    feedCategory?: string;
    matchedTerms?: string[];
    snippet?: string;
    analyzer?: string;
    [key: string]: unknown;
  };
  status: PortfolioImpactStatus;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  position: Pick<PositionWithRelations, 'id' | 'tickerBbg' | 'nameCn' | 'nameEn' | 'longShort' | 'positionWeight' | 'positionAmount' | 'sectorName'>;
  feedItem: {
    id: string;
    title: string;
    type: string;
    category: string;
    source: string;
    publishedAt: string;
  };
  alerts: PortfolioImpactAlert[];
}

export interface PortfolioImpactSummary {
  netPortfolioScore: number;
  alertCount: number;
  criticalCount: number;
  warningCount: number;
  impactedPositions: number;
  unreviewed: number;
  positiveCount: number;
  negativeCount: number;
}

export interface NameMapping {
  id: number;
  bbgName: string;
  chineseName: string;
  positionId: number | null;
}

export interface CompanyResearch {
  id: number;
  positionId: number;
  strategy: string;
  tam: string;
  competition: string;
  valueProposition: string;
  longTermFactors: string;
  outlook3to5y: string;
  businessQuality: string;
  trackingData: string;
  valuation: string;
  revenueDownstream: string;
  revenueProduct: string;
  revenueCustomer: string;
  profitSplit: string;
  leverage: string;
  peerComparison: string;
  costStructure: string;
  equipment: string;
  notes: string;
}

export interface ImportHistoryItem {
  id: number;
  importType: string;
  fileName: string;
  recordCount: number;
  newCount: number;
  updatedCount: number;
  createdAt: string;
}

export interface MarketExchange {
  code: string;
  name: string;
  country?: string;
  countryIso2?: string;
  countryIso3?: string;
  currency?: string;
  operatingMic?: string;
}

export type MarketMa5Filter = 'any' | 'above' | 'below';

export interface MarketScreenerFilters {
  country?: string;
  exchange?: string;
  query?: string;
  sector?: string;
  industry?: string;
  marketCapMin?: number | string;
  marketCapMax?: number | string;
  priceMin?: number | string;
  priceMax?: number | string;
  return1dMin?: number | string;
  return1dMax?: number | string;
  return5dMin?: number | string;
  return5dMax?: number | string;
  volumeMin?: number | string;
  volumeMax?: number | string;
  avgVol200dMin?: number | string;
  avgVol200dMax?: number | string;
  priceVsMa5?: MarketMa5Filter;
  ma5DistanceMin?: number | string;
  ma5DistanceMax?: number | string;
  sort?: string;
  limit?: number;
  offset?: number;
}

export interface MarketScreenerRow {
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

export interface MarketScreenerResponse {
  items: MarketScreenerRow[];
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

export interface MarketPricePoint {
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

export interface MarketSymbolDetail {
  symbol: string;
  history: MarketPricePoint[];
  latest: MarketPricePoint | null;
  generatedAt: string;
}

export type PortfolioTechnicalSignal = 'bullish' | 'neutral' | 'bearish';
export type PortfolioTechnicalTrend = 'uptrend' | 'sideways' | 'downtrend';

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
  signal: PortfolioTechnicalSignal;
  trend: PortfolioTechnicalTrend;
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
  overallSignal?: PortfolioTechnicalSignal;
  combinedSummary?: string;
  keyObservations?: string[];
  windows: PortfolioTechnicalWindowAnalysis[];
  history: MarketPricePoint[];
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
