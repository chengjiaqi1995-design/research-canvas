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

export const getEarnings = () =>
  apiClient.get<{ success: boolean; data: any }>(`${P}/earnings`);
