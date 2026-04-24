import type { AIProvider } from '../../types';
import { transcribeWithGemini, generateSummaryWithGemini, generateTitleAndTopicsWithGemini, extractMetadataWithGemini } from './geminiService';
import { transcribeWithQwen, generateSummaryWithQwen, generateTitleAndTopicsWithQwen } from './qwenService';
import type { TranscriptionResult, TitleAndTopics, ExtractedMetadata } from './aiTypes';

type SummaryProvider = AIProvider | 'deepseek' | 'openai';

// Re-export types
export type { TranscriptionResult, TitleAndTopics, ExtractedMetadata } from './aiTypes';

// Re-export specific functions needed by consumers
export { compressAudio } from './audioProcessing';
export { getMetadataExtractionPromptTemplate } from './geminiService';

/**
 * 从模型名或 provider 字符串解析出 'gemini' | 'qwen'
 * 兼容旧格式 ('gemini'/'qwen') 和新格式 ('paraformer-v2'/'gemini-3-flash-preview' 等)
 */
export function resolveProvider(modelOrProvider: string): AIProvider {
  if (modelOrProvider === 'gemini' || modelOrProvider === 'qwen') return modelOrProvider;
  if (modelOrProvider.startsWith('gemini')) return 'gemini';
  // paraformer, qwen3-asr, fun-asr 等都属于 qwen/dashscope
  return 'qwen';
}

export function resolveSummaryProvider(modelOrProvider: string): SummaryProvider {
  if (modelOrProvider === 'gemini' || modelOrProvider === 'google') return 'gemini';
  if (modelOrProvider === 'qwen' || modelOrProvider === 'dashscope') return 'qwen';
  if (modelOrProvider === 'deepseek' || modelOrProvider.includes('deepseek')) return 'deepseek';
  if (modelOrProvider === 'openai' || /^(gpt|o[134]-)/.test(modelOrProvider)) return 'openai';
  if (modelOrProvider.startsWith('gemini')) return 'gemini';
  if (modelOrProvider.includes('qwen')) return 'qwen';
  return resolveProvider(modelOrProvider);
}

function buildSummaryPrompt(text: string, customPrompt?: string): string {
  if (customPrompt) {
    return customPrompt.replace('{text}', text);
  }

  return `请对以下文本进行总结，要求简洁明了，突出重点：

${text}

总结：`;
}

async function generateSummaryWithOpenAICompatible(
  text: string,
  apiKey: string | undefined,
  customPrompt: string | undefined,
  model: string,
  provider: 'deepseek' | 'openai'
): Promise<string> {
  if (!apiKey) {
    throw new Error(`${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} API Key 未设置`);
  }

  const axios = require('axios');
  const prompt = buildSummaryPrompt(text, customPrompt);
  const baseURL = provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1';
  try {
    const response = await axios.post(
      `${baseURL}/chat/completions`,
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 8192,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 600000,
      }
    );

    const summary = response.data?.choices?.[0]?.message?.content;
    if (!summary || summary.trim().length === 0) {
      throw new Error(`${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} 总结结果为空`);
    }
    return summary;
  } catch (error: any) {
    const providerName = provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
    const apiMessage = error.response?.data?.error?.message || error.response?.data?.message;
    const status = error.response?.status;
    throw new Error(`${providerName} 总结失败${status ? ` (${status})` : ''}: ${apiMessage || error.message || '未知错误'}`);
  }
}

/**
 * 使用 AI 服务进行音频转录
 * @param fileUrl 文件路径（本地）或 GCS URL
 */
export async function transcribeAudio(
  fileUrl: string,
  aiProvider: AIProvider | string,
  apiKey?: string,
  qwenModel?: string,
  geminiModel?: string
): Promise<TranscriptionResult> {
  const provider = resolveProvider(aiProvider);
  if (provider === 'gemini') {
    return await transcribeWithGemini(fileUrl, apiKey, geminiModel);
  } else {
    return transcribeWithQwen(fileUrl, apiKey, qwenModel);
  }
}

/**
 * 使用 AI 服务生成文本总结
 */
export async function generateSummary(
  text: string,
  aiProvider: AIProvider | string,
  apiKey?: string,
  customPrompt?: string,
  model?: string
): Promise<string> {
  const provider = resolveSummaryProvider(model || aiProvider);
  if (provider === 'gemini') {
    return generateSummaryWithGemini(text, apiKey, customPrompt, model);
  } else if (provider === 'qwen') {
    return generateSummaryWithQwen(text, apiKey, customPrompt);
  }
  return generateSummaryWithOpenAICompatible(text, apiKey, customPrompt, model || `${provider}-chat`, provider);
}

/**
 * 使用 AI 服务生成标题和相关主题
 */
export async function generateTitleAndTopics(
  transcriptText: string,
  summary: string,
  aiProvider: AIProvider | string,
  apiKey?: string,
  date?: Date
): Promise<TitleAndTopics> {
  const provider = resolveProvider(aiProvider);
  if (provider === 'gemini') {
    return generateTitleAndTopicsWithGemini(transcriptText, summary, apiKey, date);
  } else {
    return generateTitleAndTopicsWithQwen(transcriptText, summary, apiKey, date);
  }
}

/**
 * 使用 AI 提取元数据（主题、机构、参与人、发生时间）
 */
export async function extractMetadata(
  transcriptText: string,
  summary: string,
  aiProvider: AIProvider | string,
  apiKey?: string,
  customMetadataPrompt?: string,
  geminiModel?: string
): Promise<ExtractedMetadata> {
  const provider = resolveProvider(aiProvider);
  if (provider === 'gemini') {
    return extractMetadataWithGemini(transcriptText, summary, apiKey, customMetadataPrompt, geminiModel);
  } else {
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
  }
}
