// Shared types used across components

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

export interface TaxonomyItem {
  id: number;
  type: string;
  name: string;
  parentId: number | null;
  sortOrder: number;
  children?: TaxonomyItem[];
  parent?: TaxonomyItem | null;
}

export interface TaxonomyTree extends TaxonomyItem {
  children: TaxonomyTree[];
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
  transactionType: "buy" | "sell";
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
