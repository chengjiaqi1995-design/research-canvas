import apiClient from './client';
import type {
  Transcription,
  CreateTranscriptionRequest,
  ApiResponse,
  PaginatedResponse,
  PaginationParams,
} from '../types';

// ============ Signed URL 直传方案 ============

interface SignedUrlResponse {
  signedUrl: string;
  fileUrl: string;
  filePath: string;
  storageType: 'gcs' | 'oss-singapore' | 'oss-china';
  model: string;
}

async function loadProviderKeys(): Promise<Record<string, string>> {
  try {
    const { aiApi } = await import('../../db/apiClient');
    const settings = await aiApi.getSettings({ revealKeys: true });
    return settings.keys || {};
  } catch (error) {
    console.warn('获取 AI 密钥配置失败，后端将使用本次请求中已有的密钥:', error);
    return {};
  }
}

/**
 * 获取上传签名 URL
 * @param fileName 文件名
 * @param model 模型名称 (gemini, paraformer-v2, qwen3-asr-flash-filetrans)
 * @param contentType MIME 类型
 */
export const getUploadSignedUrl = async (
  fileName: string,
  model: string,
  contentType: string = 'audio/mpeg'
): Promise<ApiResponse<SignedUrlResponse>> => {
  const response = await apiClient.get<ApiResponse<SignedUrlResponse>>(
    '/upload/signed-url',
    {
      params: { fileName, model, contentType },
    }
  );
  return response.data;
};

/**
 * 确认文件上传完成，设置文件为公开
 */
export const confirmUpload = async (
  filePath: string,
  storageType: string
): Promise<ApiResponse<void>> => {
  const response = await apiClient.post<ApiResponse<void>>(
    '/upload/confirm',
    { filePath, storageType }
  );
  return response.data;
};

/**
 * 直接上传文件到云存储（使用签名 URL）
 * @param signedUrl 签名 URL
 * @param file 文件
 * @param contentType MIME 类型
 * @param onProgress 进度回调
 */
export const uploadToStorage = async (
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        console.error(`直传上传失败: ${xhr.status} ${xhr.statusText}`, xhr.responseText);
        reject(new Error(`上传失败: ${xhr.status} ${xhr.statusText}`));
      }
    });

    xhr.addEventListener('error', (e) => {
      console.error('直传网络错误，可能是 CORS 问题:', e);
      reject(new Error('网络错误（可能是云存储 CORS 未配置）'));
    });

    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(file);
  });
};

/**
 * 通过文件 URL 创建转录（Signed URL 直传方案）
 */
export const createTranscriptionFromUrl = async (params: {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  aiProvider: string;
  qwenApiKey?: string;
  geminiApiKey?: string;
  qwenModel?: string;
  customPrompt?: string;
  metadataFillPrompt?: string;
  storageType: string;
  transcriptionModel?: string;
  summaryModel?: string;
  metadataModel?: string;
  providerKeys?: Record<string, string>;
}): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.post<ApiResponse<Transcription>>(
    '/transcriptions/from-url',
    params
  );
  return response.data;
};

/**
 * 完整的直传上传流程
 * 1. 获取签名 URL
 * 2. 直传到云存储
 * 3. 确认上传
 * 4. 创建转录记录
 * 
 * 如果直传失败（如 CORS 问题），自动回退到后端上传
 */
export const uploadWithSignedUrl = async (
  file: File,
  model: string,
  aiProvider: string,
  options: {
    qwenApiKey?: string;
    geminiApiKey?: string;
    qwenModel?: string;
    customPrompt?: string;
    metadataFillPrompt?: string;
    onProgress?: (percent: number) => void;
    transcriptionModel?: string;
    summaryModel?: string;
    metadataModel?: string;
    providerKeys?: Record<string, string>;
  } = {}
): Promise<ApiResponse<Transcription>> => {
  const { qwenApiKey, geminiApiKey, qwenModel, customPrompt, metadataFillPrompt, onProgress, transcriptionModel, summaryModel, metadataModel } = options;
  const contentType = file.type || 'audio/mpeg';
  const providerKeys = options.providerKeys || await loadProviderKeys();

  try {
    // 1. 获取签名 URL
    const signedUrlResponse = await getUploadSignedUrl(file.name, model, contentType);

    if (!signedUrlResponse.success || !signedUrlResponse.data) {
      throw new Error(signedUrlResponse.error || '获取上传签名 URL 失败');
    }

    const { signedUrl, fileUrl, filePath, storageType } = signedUrlResponse.data;

    // 2. 直传到云存储
    await uploadToStorage(signedUrl, file, contentType, onProgress);

    // 3. 确认上传（设置文件为公开）
    await confirmUpload(filePath, storageType);

    // 4. 创建转录记录
    const transcriptionResponse = await createTranscriptionFromUrl({
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
      aiProvider,
      qwenApiKey,
      geminiApiKey,
      qwenModel,
      customPrompt,
      metadataFillPrompt,
      storageType,
      transcriptionModel,
      summaryModel,
      metadataModel,
      providerKeys,
    });

    return transcriptionResponse;
  } catch (error: any) {
    // 如果直传失败（如 CORS 问题），回退到后端上传
    console.warn('⚠️ 直传上传失败，回退到后端上传:', error.message);

    // 使用原来的后端上传方式
    return await createTranscription({
      file,
      aiProvider: aiProvider as any,
      qwenApiKey,
      geminiApiKey,
      qwenModel,
      customPrompt,
      metadataFillPrompt,
      transcriptionModel,
      summaryModel,
      metadataModel,
      providerKeys,
    });
  }
};

// ============ 原有的上传方式（保留兼容） ============

// 上传音频并创建转录（通过后端中转，有 32MB 限制）
export const createTranscription = async (
  request: CreateTranscriptionRequest
): Promise<ApiResponse<Transcription>> => {
  const formData = new FormData();
  formData.append('audio', request.file);
  formData.append('aiProvider', request.aiProvider);

  // 如果提供了 API 密钥，添加到请求中
  if (request.qwenApiKey) {
    formData.append('qwenApiKey', request.qwenApiKey);
  }
  if (request.geminiApiKey) {
    formData.append('geminiApiKey', request.geminiApiKey);
  }
  if (request.providerKeys && Object.keys(request.providerKeys).length > 0) {
    formData.append('providerKeys', JSON.stringify(request.providerKeys));
  }

  // 添加千问模型选择
  if (request.qwenModel) {
    formData.append('qwenModel', request.qwenModel);
  }

  // 添加自定义 Prompt
  if (request.customPrompt) {
    formData.append('customPrompt', request.customPrompt);
  }
  if (request.metadataFillPrompt) {
    formData.append('metadataFillPrompt', request.metadataFillPrompt);
  }

  // 添加模型选择
  if (request.transcriptionModel) {
    formData.append('transcriptionModel', request.transcriptionModel);
  }
  if (request.summaryModel) {
    formData.append('summaryModel', request.summaryModel);
  }
  if (request.metadataModel) {
    formData.append('metadataModel', request.metadataModel);
  }

  const response = await apiClient.post<ApiResponse<Transcription>>(
    '/transcriptions',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return response.data;
};

// 获取转录列表
export const getTranscriptions = async (
  params?: PaginationParams & {
    sortBy?: 'createdAt' | 'actualDate'; // 排序方式：导入日期或实际日期
    sortOrder?: 'asc' | 'desc'; // 排序顺序
    projectId?: string | null; // 项目筛选（null 表示未归类的）
    tag?: string | null; // 标签筛选
  }
): Promise<ApiResponse<PaginatedResponse<Transcription>>> => {
  const response = await apiClient.get<ApiResponse<PaginatedResponse<Transcription>>>(
    '/transcriptions',
    { params }
  );

  return response.data;
};

// 获取 Directory 页面数据（轻量级，不含大文本字段）
export const getDirectoryData = async (
  params?: { tag?: string | null }
): Promise<ApiResponse<{ items: Transcription[]; total: number }>> => {
  const response = await apiClient.get<ApiResponse<{ items: Transcription[]; total: number }>>(
    '/transcriptions/directory',
    { params }
  );
  return response.data;
};

// 批量重新分类行业
export const reclassifyIndustries = async (
  params?: { geminiApiKey?: string; geminiModel?: string; dryRun?: boolean }
): Promise<ApiResponse<{
  summary: {
    total: number;
    kept: number;
    mapped: number;
    portfolioMatched: number;
    geminiClassified: number;
    changed: number;
    unchanged: number;
    dryRun: boolean;
    newIndustriesCount: number;
  };
  details: Array<{
    id: string;
    fileName: string;
    oldIndustry: string | null;
    newIndustry: string;
    method: 'keep' | 'mapping' | 'portfolio' | 'gemini';
  }>;
  newIndustries: string[];
}>> => {
  const response = await apiClient.post('/transcriptions/reclassify-industries', params || {});
  return response.data;
};

// 批量归一化公司名称
export const normalizeCompanies = async (
  params?: { geminiApiKey?: string; geminiModel?: string; dryRun?: boolean; approvedMapping?: Record<string, string> }
): Promise<ApiResponse<{
  old: string;
  new: string;
  count: number;
  method: 'portfolio' | 'ai';
}[]>> => {
  const response = await apiClient.post('/transcriptions/normalize-companies', params || {});
  return response.data;
};

// 手动覆盖公司行业和名
export const updateCompanyIndustry = async (
  organization: string,
  newIndustry: string,
  newOrganization?: string
): Promise<ApiResponse<{ success: boolean; count: number }>> => {
  const response = await apiClient.put('/transcriptions/update-industry', {
    organization,
    newIndustry,
    newOrganization
  });
  return response.data;
};

// 获取单个转录详情
export const getTranscription = async (
  id: string
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.get<ApiResponse<Transcription>>(
    `/transcriptions/${id}`
  );

  return response.data;
};

// 更新转录总结
export const updateTranscriptionSummary = async (
  id: string,
  summary: string,
  version?: number
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.patch<ApiResponse<Transcription>>(
    `/transcriptions/${id}/summary`,
    { summary, version }
  );

  return response.data;
};

// 更新转录中文总结
export const updateTranscriptionTranslatedSummary = async (
  id: string,
  translatedSummary: string,
  version?: number
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.patch<ApiResponse<Transcription>>(
    `/transcriptions/${id}/translated-summary`,
    { translatedSummary, version }
  );

  return response.data;
};

// 更新转录文件名
export const updateTranscriptionFileName = async (
  id: string,
  fileName: string
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.patch<ApiResponse<Transcription>>(
    `/transcriptions/${id}/file-name`,
    { fileName }
  );

  return response.data;
};

// 更新转录标签
export const updateTranscriptionTags = async (
  id: string,
  tags: string[]
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.patch<ApiResponse<Transcription>>(
    `/transcriptions/${id}/tags`,
    { tags }
  );

  return response.data;
};

// 更新转录实际发生日期
export const updateTranscriptionActualDate = async (
  id: string,
  actualDate: string | null
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.patch<ApiResponse<Transcription>>(
    `/transcriptions/${id}/actual-date`,
    { actualDate }
  );

  return response.data;
};

// 更新转录所属项目
export const updateTranscriptionProject = async (
  id: string,
  projectId: string | null
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.patch<ApiResponse<Transcription>>(
    `/transcriptions/${id}/project`,
    { projectId }
  );

  return response.data;
};

// 更新转录元数据（主题、机构、中介、行业、国家、参与人、发生时间）
export const updateTranscriptionMetadata = async (
  id: string,
  metadata: {
    topic?: string;
    organization?: string;
    intermediary?: string;
    industry?: string;
    country?: string;
    participants?: string;
    eventDate?: string;
    speaker?: string;
  }
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.patch<ApiResponse<Transcription>>(
    `/transcriptions/${id}/metadata`,
    metadata
  );

  return response.data;
};

// 删除转录
export const deleteTranscription = async (
  id: string
): Promise<ApiResponse<void>> => {
  const response = await apiClient.delete<ApiResponse<void>>(
    `/transcriptions/${id}`
  );

  return response.data;
};

// 强制重新处理转录
export const reprocessTranscription = async (
  id: string,
  qwenApiKey?: string,
  geminiApiKey?: string,
  customPrompt?: string,
  extra?: {
    metadataFillPrompt?: string;
    summaryModel?: string;
    metadataModel?: string;
    providerKeys?: Record<string, string>;
  }
): Promise<ApiResponse<Transcription>> => {
  const providerKeys = extra?.providerKeys || await loadProviderKeys();
  const response = await apiClient.post<ApiResponse<Transcription>>(
    `/transcriptions/${id}/reprocess`,
    {
      qwenApiKey,
      geminiApiKey,
      customPrompt,
      metadataFillPrompt: extra?.metadataFillPrompt,
      summaryModel: extra?.summaryModel,
      metadataModel: extra?.metadataModel,
      providerKeys,
    }
  );
  return response.data;
};

// 重新生成AI总结/元数据
export const regenerateSummary = async (
  id: string,
  aiProvider?: string,
  customPrompt?: string,
  geminiApiKey?: string,
  qwenApiKey?: string,
  action?: 'summary' | 'metadata' | 'all',
  metadataPrompt?: string,
  summaryModel?: string,
  metadataModel?: string,
  providerKeys?: Record<string, string>
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.post<ApiResponse<Transcription>>(
    `/transcriptions/${id}/regenerate-summary`,
    { aiProvider, customPrompt, geminiApiKey, qwenApiKey, action: action || 'all', metadataPrompt, summaryModel, metadataModel, providerKeys }
  );

  return response.data;
};

// 创建合并历史
export const createMergeHistory = async (
  fileName: string,
  summary: string,
  mergeSources: Array<{ id: string; title: string; content: string }>,
  aiProvider?: string
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.post<ApiResponse<Transcription>>(
    '/transcriptions/merge',
    {
      fileName,
      summary,
      mergeSources,
      aiProvider: aiProvider || 'gemini',
    }
  );
  return response.data;
};

// 从文本创建笔记（用于新建笔记和 Chrome 扩展）
export const createFromText = async (params: {
  text: string;
  sourceUrl?: string;
  sourceTitle?: string;
  geminiApiKey?: string;
  customPrompt?: string;
  metadataFillPrompt?: string;
  summaryModel?: string;
  providerKeys?: Record<string, string>;
}): Promise<ApiResponse<Transcription>> => {
  const providerKeys = params.providerKeys || await loadProviderKeys();
  const response = await apiClient.post<ApiResponse<Transcription>>(
    '/transcriptions/from-text',
    { ...params, providerKeys }
  );
  return response.data;
};

// 导入 Markdown 笔记
export const importMarkdown = async (params: {
  notes: Array<{ fileName: string; content: string }>;
}): Promise<ApiResponse<Transcription[]>> => {
  const response = await apiClient.post<ApiResponse<Transcription[]>>(
    '/transcriptions/import-markdown',
    params
  );
  return response.data;
};

// 生成周度总结
export const generateWeeklySummary = async (
  weekStart?: string,
  customPrompt?: string,
  geminiApiKey?: string,
  weeklySummaryModel?: string,
  weekEnd?: string
): Promise<ApiResponse<Transcription>> => {
  const response = await apiClient.post<ApiResponse<Transcription>>(
    '/transcriptions/generate-weekly',
    { weekStart, weekEnd, customPrompt, geminiApiKey, weeklySummaryModel },
    { timeout: 200000 } // 3分钟+超时，周报生成较慢
  );
  return response.data;
};

// 诊断接口：检查数据库连接和数据统计
export const getDiagnostics = async (): Promise<ApiResponse<{
  database: {
    connected: boolean;
    error: string | null;
    info: {
      host: string;
      database: string;
      provider: string;
    } | null;
  };
  user: {
    id: string;
  };
  statistics: {
    total: number;
    notes: number;
    transcriptions: number;
    merges: number;
    byTypeAndStatus: Array<{ type: string; status: string; _count: number }>;
  };
  recentNotes: Array<{ id: string; fileName: string; createdAt: string }>;
  timestamp: string;
}>> => {
  const response = await apiClient.get('/transcriptions/diagnostics');
  return response.data;
};

// 批量标记转录已同步到 Canvas
export const markSyncedToCanvas = async (ids: string[]): Promise<ApiResponse<{ updated: number }>> => {
  const response = await apiClient.post('/transcriptions/mark-synced-to-canvas', { ids });
  return response.data;
};

// ==================== 周报设置管理（Skill + Prompts） ====================

export interface WeeklySettings {
  skillContent: string;
  userPrompt: string;
  systemPrompt: string;
}

export const getWeeklySettings = async (): Promise<ApiResponse<WeeklySettings>> => {
  const response = await apiClient.get<ApiResponse<WeeklySettings>>('/transcriptions/weekly-settings');
  return response.data;
};

export const updateWeeklySettings = async (
  data: Partial<WeeklySettings>
): Promise<ApiResponse<null>> => {
  const response = await apiClient.put<ApiResponse<null>>('/transcriptions/weekly-settings', data);
  return response.data;
};
