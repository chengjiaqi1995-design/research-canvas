// AI服务提供商类型
export type AIProvider = 'gemini' | 'qwen';

// 转录状态
export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed';

// 转录类型
export type TranscriptionType = 'transcription' | 'merge' | 'note' | 'weekly-summary';

// 转录记录接口
export interface Transcription {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  duration?: number;
  aiProvider: AIProvider;
  status: TranscriptionStatus;
  transcriptText: string;
  summary: string;
  translatedSummary?: string; // 中文翻译的总结
  errorMessage?: string;
  processingStep?: string | null; // 'transcribing' | 'summarizing' | 'extracting_metadata' | 'finalizing'
  tags?: string[]; // Array of tags, max 5
  actualDate?: string | null; // 实际发生日期（可手动输入）
  projectId?: string | null; // 所属项目ID
  project?: {
    id: string;
    name: string;
  } | null; // 项目信息
  type?: TranscriptionType; // 'transcription' or 'merge'
  mergeSources?: Array<{ id: string; title: string; content: string }>; // 合并源（仅合并类型）
  // AI 自动提取的元数据
  topic?: string;        // 主题
  organization?: string; // 公司
  intermediary?: string; // 中介
  industry?: string;     // 行业（用户手动选择）
  country?: string;      // 国家
  participants?: string; // 参与人类型（company/expert/sellside）
  eventDate?: string;    // 发生时间
  speaker?: string;      // 演讲人/嘉宾
  lastSyncedAt?: string; // 最后一次同步到知识库的时间
  version?: number; // 乐观锁版本号，用于防止并发覆盖
  createdAt: string;
  updatedAt: string;
}

// 项目接口
export interface Project {
  id: string;
  name: string;
  description?: string | null;
  transcriptionCount?: number; // 转录记录数量
  createdAt: string;
  updatedAt: string;
}

// 创建转录请求
export interface CreateTranscriptionRequest {
  file: File;
  aiProvider: AIProvider;
  qwenApiKey?: string;
  geminiApiKey?: string;
  qwenModel?: string; // 千问模型选择
  customPrompt?: string; // 自定义总结 Prompt
  metadataFillPrompt?: string; // 元数据提取 Prompt（已填充占位符）
  transcriptionModel?: string;
  summaryModel?: string;
  metadataModel?: string;
  providerKeys?: Record<string, string>;
}

// API响应接口
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 周度总结数据（存储在 transcriptText 中的 JSON）
export interface WeeklySummaryData {
  weekStart: string;
  weekEnd: string;
  highlights: Array<{
    text: string;
    sourceId: string;
    sourceTitle: string;
    organization?: string;
    industry?: string;
  }>;
  benchmark: {
    newCompanies: string[];
    newIndustries: string[];
    newTopics: string[];
    recurringCompanies: string[];
    recurringTopics: string[];
    droppedCompanies: string[];
    droppedTopics: string[];
    thisWeekNoteCount: number;
    lastWeekNoteCount: number;
  };
  metadata: {
    companies: string[];
    industries: string[];
    topics: string[];
  };
  customPrompt: string;
  noteCount: number;
}

// 分页参数
export interface PaginationParams {
  page: number;
  pageSize: number;
}

// 分页响应
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
