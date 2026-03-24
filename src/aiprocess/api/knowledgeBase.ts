import apiClient from './client';

export interface KnowledgeBaseStatus {
  configured: boolean;
  projectId?: string;
  dataStoreId?: string;
  appId?: string;
  location?: string;
  message: string;
  lastSyncedAt?: string | null;
  totalNotes?: number;
  syncedNotes?: number;
}

export interface SearchResult {
  document: {
    id: string;
    name: string;
    structData?: {
      content?: string;
      fileName?: string;
      topic?: string;
      organization?: string;
      participants?: string;
      eventDate?: string;
      tags?: string[];
      createdAt?: string;
    };
  };
  id: string;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  nextPageToken?: string;
  totalSize?: number;
}

export interface SyncResponse {
  success: boolean;
  message: string;
  synced: number;
  failed: number;
  errors?: string[];
}

export interface IndexResponse {
  success: boolean;
  message: string;
}

export const getKnowledgeBaseStatus = async (): Promise<KnowledgeBaseStatus> => {
  const response = await apiClient.get<KnowledgeBaseStatus>('/knowledge-base/status');
  return response.data;
};

export interface SearchFilters {
  topic?: string;
  organization?: string;
  participants?: string;
  startDate?: string;
  endDate?: string;
}

export const searchKnowledgeBase = async (
  query: string,
  pageSize: number = 10,
  pageToken?: string,
  filters?: SearchFilters
): Promise<SearchResponse> => {
  const response = await apiClient.post<SearchResponse>('/knowledge-base/search', {
    query,
    pageSize,
    pageToken,
    filters,
  });
  return response.data;
};

export const syncAllTranscriptions = async (): Promise<SyncResponse> => {
  const response = await apiClient.post<SyncResponse>('/knowledge-base/sync');
  return response.data;
};

export const indexTranscription = async (id: string): Promise<IndexResponse> => {
  const response = await apiClient.post<IndexResponse>(
    `/knowledge-base/index/${id}`
  );
  return response.data;
};

export const deleteIndex = async (id: string): Promise<IndexResponse> => {
  const response = await apiClient.delete<IndexResponse>(
    `/knowledge-base/index/${id}`
  );
  return response.data;
};

export interface IndexProgress {
  success: boolean;
  uploaded: number;
  indexed: number;
  percentage: number;
  isComplete: boolean;
}

export const getIndexProgress = async (): Promise<IndexProgress> => {
  const response = await apiClient.get<IndexProgress>('/knowledge-base/index-progress');
  return response.data;
};

export interface NotebookLmCitation {
  sourceId?: string;
  sourceTitle?: string;
  snippet?: string;
  url?: string;
}

export interface NotebookLmQueryResponse {
  success: boolean;
  answer: string;
  citations: NotebookLmCitation[];
  sourcesIncluded: number;
  sourcesTotal: number;
  truncated: boolean;
}

export const queryNotebookLm = async (question: string): Promise<NotebookLmQueryResponse> => {
  const response = await apiClient.post<NotebookLmQueryResponse>('/knowledge-base/notebooklm/query', {
    question,
  });
  return response.data;
};