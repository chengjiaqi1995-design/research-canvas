import type { AIProvider } from '../../types';
import { transcribeWithGemini, generateSummaryWithGemini, generateTitleAndTopicsWithGemini, extractMetadataWithGemini } from './geminiService';
import { transcribeWithQwen, generateSummaryWithQwen, generateTitleAndTopicsWithQwen } from './qwenService';
import type { TranscriptionResult, TitleAndTopics, ExtractedMetadata } from './aiTypes';

// Re-export types
export type { TranscriptionResult, TitleAndTopics, ExtractedMetadata } from './aiTypes';

// Re-export specific functions needed by consumers
export { compressAudio } from './audioProcessing';
export { getMetadataExtractionPromptTemplate } from './geminiService';

/**
 * 使用 AI 服务进行音频转录
 * @param fileUrl 文件路径（本地）或 GCS URL
 */
export async function transcribeAudio(
  fileUrl: string,
  aiProvider: AIProvider,
  apiKey?: string,
  qwenModel?: string,
  geminiModel?: string
): Promise<TranscriptionResult> {
  if (aiProvider === 'gemini') {
    return await transcribeWithGemini(fileUrl, apiKey, geminiModel);
  } else if (aiProvider === 'qwen') {
    return transcribeWithQwen(fileUrl, apiKey, qwenModel);
  } else {
    throw new Error(`不支持的 AI 服务: ${aiProvider}`);
  }
}

/**
 * 使用 AI 服务生成文本总结
 */
export async function generateSummary(
  text: string,
  aiProvider: AIProvider,
  apiKey?: string,
  customPrompt?: string,
  geminiModel?: string
): Promise<string> {
  if (aiProvider === 'gemini') {
    return generateSummaryWithGemini(text, apiKey, customPrompt, geminiModel);
  } else if (aiProvider === 'qwen') {
    return generateSummaryWithQwen(text, apiKey, customPrompt);
  } else {
    throw new Error(`不支持的 AI 服务: ${aiProvider}`);
  }
}

/**
 * 使用 AI 服务生成标题和相关主题
 */
export async function generateTitleAndTopics(
  transcriptText: string,
  summary: string,
  aiProvider: AIProvider,
  apiKey?: string,
  date?: Date
): Promise<TitleAndTopics> {
  if (aiProvider === 'gemini') {
    return generateTitleAndTopicsWithGemini(transcriptText, summary, apiKey, date);
  } else if (aiProvider === 'qwen') {
    return generateTitleAndTopicsWithQwen(transcriptText, summary, apiKey, date);
  } else {
    throw new Error(`不支持的 AI 服务: ${aiProvider}`);
  }
}

/**
 * 使用 AI 提取元数据（主题、机构、参与人、发生时间）
 */
export async function extractMetadata(
  transcriptText: string,
  summary: string,
  aiProvider: AIProvider,
  apiKey?: string,
  customMetadataPrompt?: string,
  geminiModel?: string
): Promise<ExtractedMetadata> {
  if (aiProvider === 'gemini') {
    return extractMetadataWithGemini(transcriptText, summary, apiKey, customMetadataPrompt, geminiModel);
  } else if (aiProvider === 'qwen') {
    // Qwen 暂不支持，返回默认值
    return {
      topic: '会议记录',
      organization: '相关公司',
      speaker: '',
      intermediary: '未知',
      industry: '未知',
      country: '中国',
      participants: 'Management',
      eventDate: new Date().toLocaleDateString('zh-CN'),
      relatedTopics: [],
    };
  } else {
    throw new Error(`不支持的 AI 服务: ${aiProvider}`);
  }
}
