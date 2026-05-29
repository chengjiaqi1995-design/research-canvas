import apiClient from './client';
import type {
  PositionWithRelations,
  TaxonomyItem,
  PortfolioSummary,
  PortfolioSettings,
  TradeWithItems,
  TradeItemInput,
  NameMapping,
  CompanyResearch,
  ImportHistoryItem,
  MarketExchange,
  MarketClassificationOptions,
  MarketScreenerFilters,
  MarketScreenerResponse,
  MarketSymbolDetail,
  PortfolioTechnicalAnalysisResponse,
  PortfolioSectorIndexResponse,
  PortfolioFeedImpact,
  PortfolioImpactAlert,
  PortfolioImpactAlertStatus,
  PortfolioImpactStatus,
  PortfolioImpactSummary,
  FmpEarningsTableResult,
  FmpSymbolResolveResult,
} from '../types/portfolio';

const P = '/portfolio';

// ─── Settings ───
export const getPortfolioSettings = () =>
  apiClient.get<{ success: boolean; data: PortfolioSettings }>(`${P}/settings`);

export const updatePortfolioSettings = (data: Partial<PortfolioSettings>) =>
  apiClient.put<{ success: boolean; data: PortfolioSettings }>(`${P}/settings`, data);

// ─── Summary ───
export const getPortfolioSummary = () =>
  apiClient.get<{ success: boolean; data: PortfolioSummary }>(`${P}/summary`);

// ─── Information-flow impacts ───
export const getPortfolioImpacts = (params?: {
  days?: number;
  positionId?: number;
  feedItemId?: string;
  onlyAlerts?: boolean;
  status?: PortfolioImpactStatus;
  limit?: number;
}) =>
  apiClient.get<{
    success: boolean;
    data: { impacts: PortfolioFeedImpact[]; summary: PortfolioImpactSummary };
  }>(`${P}/impacts`, {
    params: {
      ...params,
      onlyAlerts: params?.onlyAlerts ? 'true' : undefined,
    },
  });

export const runPortfolioImpactAnalysis = (data?: {
  days?: number;
  since?: string;
  feedItemId?: string;
  limit?: number;
  analyzer?: 'llm-gemini-v1' | 'deterministic-v1';
  model?: string;
  maxPairs?: number;
  feedTypes?: Array<'news' | 'industry' | 'weekly' | 'macro' | 'report' | 'podcast'>;
}) =>
  apiClient.post<{
    success: boolean;
    data: {
      processedFeedCount: number;
      positionCount: number;
      candidateCount?: number;
      impactCount: number;
      alertCount: number;
      touchedImpactIds: string[];
      analyzer: string;
      model?: string;
    };
  }>(`${P}/impacts/run`, data || {});

export const getPortfolioImpactAgentContext = (data?: {
  days?: number;
  since?: string;
  feedItemId?: string;
  limit?: number;
  maxPairs?: number;
  feedTypes?: Array<'news' | 'industry' | 'weekly' | 'macro' | 'report' | 'podcast'>;
}) =>
  apiClient.post<{
    success: boolean;
    data: {
      analyzer: 'agent-direct-v1';
      generatedAt: string;
      processedFeedCount: number;
      positionCount: number;
      candidateCount: number;
      staleFeedItemIds: string[];
      applyEndpoint: string;
      instructions: string;
      items: unknown[];
    };
  }>(`${P}/impacts/agent-context`, data || {});

export const applyPortfolioImpactAgentAnalysis = (data: {
  staleFeedItemIds?: string[];
  results: unknown[];
}) =>
  apiClient.post<{
    success: boolean;
    data: {
      analyzer: 'agent-direct-v1';
      processedResultCount: number;
      impactCount: number;
      alertCount: number;
      touchedImpactIds: string[];
      skipped: { itemId?: string; reason: string }[];
    };
  }>(`${P}/impacts/agent-apply`, data);

export const updatePortfolioImpact = (id: string, status: PortfolioImpactStatus) =>
  apiClient.patch<{ success: boolean; data: PortfolioFeedImpact }>(`${P}/impacts/${id}`, { status });

export const updatePortfolioImpactAlert = (id: string, status: PortfolioImpactAlertStatus) =>
  apiClient.patch<{ success: boolean; data: PortfolioImpactAlert }>(`${P}/impact-alerts/${id}`, { status });

// ─── Positions ───
export const getPositions = (params?: Record<string, string>) =>
  apiClient.get<{ success: boolean; data: PositionWithRelations[] }>(`${P}/positions`, { params });

export const getPosition = (id: number) =>
  apiClient.get<{ success: boolean; data: PositionWithRelations }>(`${P}/positions/${id}`);

export const createPosition = (data: Partial<PositionWithRelations>) =>
  apiClient.post<{ success: boolean; data: PositionWithRelations }>(`${P}/positions`, data);

export const updatePosition = (id: number, data: Partial<PositionWithRelations>) =>
  apiClient.put<{ success: boolean; data: PositionWithRelations }>(`${P}/positions/${id}`, data);

export const deletePosition = (id: number) =>
  apiClient.delete<{ success: boolean }>(`${P}/positions/${id}`);

// ─── Taxonomy ───
export const getTaxonomies = (type?: string) =>
  apiClient.get<{ success: boolean; data: TaxonomyItem[] }>(`${P}/taxonomy`, { params: type ? { type } : undefined });

export const createTaxonomy = (data: { type: string; name: string; parentId?: number; sortOrder?: number }) =>
  apiClient.post<{ success: boolean; data: TaxonomyItem }>(`${P}/taxonomy`, data);

export const updateTaxonomy = (id: number, data: Partial<TaxonomyItem>) =>
  apiClient.put<{ success: boolean; data: TaxonomyItem }>(`${P}/taxonomy/${id}`, data);

export const deleteTaxonomy = (id: number) =>
  apiClient.delete<{ success: boolean }>(`${P}/taxonomy/${id}`);

// ─── Trades ───
export const getTrades = () =>
  apiClient.get<{ success: boolean; data: TradeWithItems[] }>(`${P}/trades`);

export const getTrade = (id: number) =>
  apiClient.get<{ success: boolean; data: TradeWithItems }>(`${P}/trades/${id}`);

export const createTrade = (data: { items: TradeItemInput[]; note?: string }) =>
  apiClient.post<{ success: boolean; data: TradeWithItems }>(`${P}/trades`, data);

export const updateTrade = (id: number, data: { status?: string; note?: string; items?: TradeItemInput[] }) =>
  apiClient.put<{ success: boolean; data: TradeWithItems }>(`${P}/trades/${id}`, data);

export const deleteTrade = (id: number) =>
  apiClient.delete<{ success: boolean }>(`${P}/trades/${id}`);

export const exportTrade = (id: number) =>
  apiClient.get(`${P}/trades/${id}/export`, { responseType: 'blob' });

// ─── Research ───
export const getResearchList = () =>
  apiClient.get<{ success: boolean; data: CompanyResearch[] }>(`${P}/research`);

export const getResearch = (positionId: number) =>
  apiClient.get<{ success: boolean; data: CompanyResearch }>(`${P}/research/${positionId}`);

export const saveResearch = (positionId: number, data: Partial<CompanyResearch>) =>
  apiClient.put<{ success: boolean; data: CompanyResearch }>(`${P}/research/${positionId}`, data);

// ─── Name Mappings ───
export const getNameMappings = () =>
  apiClient.get<{ success: boolean; data: NameMapping[] }>(`${P}/name-mappings`);

export const createNameMapping = (data: { bbgName: string; chineseName: string; positionId?: number }) =>
  apiClient.post<{ success: boolean; data: NameMapping }>(`${P}/name-mappings`, data);

export const updateNameMapping = (id: number, data: Partial<NameMapping>) =>
  apiClient.put<{ success: boolean; data: NameMapping }>(`${P}/name-mappings/${id}`, data);

export const deleteNameMapping = (id: number) =>
  apiClient.delete<{ success: boolean }>(`${P}/name-mappings/${id}`);

// ─── Import ───
export const importPositions = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post<{ success: boolean; data: { newCount: number; updatedCount: number; totalCount: number } }>(
    `${P}/import`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
};

export const getImportHistory = () =>
  apiClient.get<{ success: boolean; data: ImportHistoryItem[] }>(`${P}/import-history`);

// ─── AI ───
export const analyzePortfolio = (data: { providerId: string; model: string; customPrompt?: string }) =>
  apiClient.post<{ success: boolean; data: any }>(`${P}/ai/analyze`, { ...data, scope: 'portfolio' });

export const analyzePosition = (data: { positionId: number; providerId: string; model: string; customPrompt?: string }) =>
  apiClient.post<{ success: boolean; data: any }>(`${P}/ai/analyze`, { ...data, scope: 'position' });

export const aiFillResearch = (data: { positionId: number; providerId: string; model: string }) =>
  apiClient.post<{ success: boolean; data: any }>(`${P}/ai/fill`, data);

export const aiTranslateNames = (data: { bbgNames: string[]; providerId: string; model: string }) =>
  apiClient.post<{ success: boolean; data: any }>(`${P}/ai/translate-names`, data);

// ─── Prices ───
export const updatePrices = () =>
  apiClient.post<{ success: boolean; data: any }>(`${P}/prices/update`);

export const getEarnings = (params?: { days?: number }) =>
  apiClient.get<{ success: boolean; data: any }>(`${P}/earnings`, { params });

// ─── Market Screener ───
export const getMarketExchanges = async () =>
  apiClient.get<{ success: boolean; data: MarketExchange[] }>(`${P}/market/exchanges`);

export const getMarketClassifications = async () =>
  apiClient.get<{ success: boolean; data: MarketClassificationOptions }>(`${P}/market/classifications`);

export const screenMarket = async (data: MarketScreenerFilters) =>
  apiClient.post<{ success: boolean; data: MarketScreenerResponse }>(`${P}/market/screener`, data);

export const getMarketSymbolDetail = async (symbol: string, days = 220, provider?: string) =>
  apiClient.get<{ success: boolean; data: MarketSymbolDetail }>(
    `${P}/market/symbol/${encodeURIComponent(symbol)}/detail`,
    { params: { days, provider } }
  );

export const analyzePortfolioTechnicals = async (params?: {
  scope?: 'active' | 'watchlist' | 'all';
  windows?: string;
  limit?: number;
  days?: number;
}) =>
  apiClient.get<{ success: boolean; data: PortfolioTechnicalAnalysisResponse }>(
    `${P}/market/technical-analysis`,
    { params }
  );

export const getPortfolioSectorIndices = async (params?: {
  scope?: 'active' | 'watchlist' | 'all';
  days?: number;
}) =>
  apiClient.get<{ success: boolean; data: PortfolioSectorIndexResponse }>(
    `${P}/market/sector-index`,
    { params }
  );

export const getFmpEarningsTable = async (params: {
  symbol: string;
  fiscalYear?: string | number;
  year?: string | number;
  quarter?: string | number;
  date?: string;
}) =>
  apiClient.get<{ success: boolean; data: FmpEarningsTableResult }>(
    `${P}/fmp/earnings-table`,
    { params }
  );

export const resolveFmpSymbol = async (params: {
  input: string;
  companyName?: string;
}) =>
  apiClient.get<{ success: boolean; data: FmpSymbolResolveResult }>(
    `${P}/fmp/resolve-symbol`,
    { params }
  );
