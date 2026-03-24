export type AIProvider = 'gemini' | 'qwen';
export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TranscriptionCreateRequest {
  aiProvider: AIProvider;
}

export interface TranscriptionUpdateSummaryRequest {
  summary: string;
  version?: number; // 乐观锁版本号，用于防止并发覆盖
}

export interface RegenerateSummaryRequest {
  aiProvider?: AIProvider;
  customPrompt?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
