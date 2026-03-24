import { GoogleGenerativeAI } from '@google/generative-ai';
import type { SourceItem, AggregationResult, AggregationMode, ProgressCallback } from './types';
import { SYSTEM_INSTRUCTION_TEMPLATE } from './constants';
import { getApiConfig } from '../../components/ApiConfigModal';

/**
 * 获取 Gemini API 密钥
 */
const getGeminiApiKey = (providedKey?: string): string => {
  if (providedKey) return providedKey;
  return getApiConfig().geminiApiKey;
};

/**
 * 使用 Gemini Vision 进行 OCR 识别
 * 支持图片和 PDF 页面
 */
export const extractTextWithGemini = async (
  imageData: string, // base64 encoded image
  mimeType: string,
  fileName: string
): Promise<string> => {
  const geminiApiKey = getGeminiApiKey();
  
  if (!geminiApiKey) {
    throw new Error('未配置 Gemini API 密钥，请在右上角配置按钮中设置');
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `请仔细识别并提取这张图片中的所有文字内容。
要求：
1. 保持原文的格式和段落结构
2. 如果有表格，尽量用文字描述或保持表格结构
3. 如果是多栏排版，按从左到右、从上到下的顺序提取
4. 只输出识别到的文字内容，不要添加任何解释或说明
5. 如果图片中没有文字，返回"[图片中未发现文字内容]"`;

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: mimeType,
        data: imageData,
      },
    },
    prompt,
  ]);

  const response = result.response;
  const text = response.text();
  
  if (!text || text.trim() === '') {
    throw new Error('未能从图片中提取到文字');
  }
  
  return text;
};

/**
 * 将文件转换为 base64
 */
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:xxx;base64, 前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Aggregate content using Gemini AI
 */
export const aggregateContent = async (
  sources: SourceItem[],
  mode: AggregationMode = 'comprehensive',
  onProgress?: ProgressCallback,
  outlinePrompt?: string,
  apiKey?: string
): Promise<AggregationResult> => {
  if (!sources || sources.length === 0) {
    throw new Error('没有提供文本源');
  }

  // Filter out empty sources
  const validSources = sources.filter(s => s.content.replace(/<[^>]*>/g, '').trim().length > 0);
  if (validSources.length === 0) {
    throw new Error('所有文本源都为空');
  }

  // Get API key from parameter or localStorage
  const geminiApiKey = getGeminiApiKey(apiKey);

  if (!geminiApiKey) {
    throw new Error('未配置 Gemini API 密钥，请在右上角配置按钮中设置');
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);

  const combinedSourceText = validSources.map((source, index) => {
    const cleanContent = source.content.replace(/<[^>]*>/g, '').trim();
    return `--- SOURCE ${index + 1}: ${source.title || 'Untitled'} ---\n${cleanContent}\n`;
  }).join('\n');

  // Simple modes (comprehensive, concise, structured)
  if (mode !== 'deep') {
    if (onProgress) onProgress('正在合成文档...', 50);

    let promptText = '请根据上述算法执行聚合。记住输出简体中文。';
    if (mode === 'concise') {
      promptText = '创建一个简洁的执行摘要。简体中文。';
    } else if (mode === 'structured') {
      promptText = '创建一个结构化报告，包含清晰的章节。简体中文。';
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-pro',
      systemInstruction: SYSTEM_INSTRUCTION_TEMPLATE,
    });
    const result = await model.generateContent(
      `${combinedSourceText}\n\n${promptText}`
    );

    const response = result.response;
    const text = response.text() || '未生成内容';
    const finishReason = response.candidates?.[0]?.finishReason as any;
    const isTruncated = finishReason === 'MAX_OUTPUT_TOKENS' || finishReason === 2;

    return { text, isTruncated: !!isTruncated };
  }

  // Deep mode - multi-step workflow
  if (onProgress) onProgress('分析源文本并规划结构...', 10);

  // Step 1: Generate outline
  const outlineModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const baseInstruction = outlinePrompt?.trim()
    ? outlinePrompt
    : `分析提供的文本源。为一份非常详细、书籍长度的合并报告创建一个逻辑目录。
       章节应涵盖源数据的所有可能方面。
       创建 4 到 8 个不同的主要章节标题（例如："财务表现"、"市场分析"、"技术规格"）。
       返回 JSON 格式：{"sections": ["章节1", "章节2", ...]}`;

  const outlineResult = await outlineModel.generateContent(
    `${combinedSourceText}\n\n${baseInstruction}\n\n**重要：** 使用简体中文。返回 JSON 格式：{"sections": ["章节1", "章节2", ...]}`
  );

  let sections: string[] = ['综合摘要'];
  try {
    const outlineText = outlineResult.response.text();
    // Try to extract JSON from the response
    const jsonMatch = outlineText.match(/\{[\s\S]*"sections"[\s\S]*\}/);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[0]);
      sections = json.sections || ['综合摘要'];
    } else {
      // Fallback: try to parse the whole text
      const json = JSON.parse(outlineText);
      sections = json.sections || ['综合摘要'];
    }
  } catch (e) {
    console.error('解析大纲失败', e);
    // Fallback: extract sections from text if JSON parsing fails
    const lines = outlineResult.response.text().split('\n').filter(line => line.trim());
    sections = lines.slice(0, 8).map(line => line.replace(/^[-\d.\s]+/, '').trim()).filter(s => s);
    if (sections.length === 0) {
      sections = ['综合摘要'];
    }
  }

  // Step 2: Generate content for each section
  let fullDocument = '# 综合分析报告（深度合并）\n\n';
  const totalSections = sections.length;
  const sectionModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  for (let i = 0; i < totalSections; i++) {
    const section = sections[i];
    const progress = 20 + Math.floor(((i + 1) / totalSections) * 70);

    if (onProgress) onProgress(`正在编写第 ${i + 1}/${totalSections} 章：${section}...`, progress);

    try {
      const sectionResult = await sectionModel.generateContent(
        `${combinedSourceText}\n\n你正在编写一份更大报告的一个章节。

当前章节标题："${section}"

任务：
1. 仅基于源文本编写此章节的内容。
2. 要极其详细。不要总结。包含具体数字、日期和引用。
3. 对任何找到的数据使用 Markdown 表格。
4. 语言：简体中文。
5. 仅输出此章节的内容。以 ## H2 标题开始。`
      );

      const sectionContent = sectionResult.response.text() || '';
      fullDocument += `${sectionContent}\n\n---\n\n`;
    } catch (err) {
      console.error(`生成章节 ${section} 失败`, err);
      fullDocument += `## ${section}\n\n[生成此章节时出错。内容可能缺失。]\n\n`;
    }
  }

  // Step 3: Finalize
  if (onProgress) onProgress('正在完成文档...', 95);

  return {
    text: fullDocument,
    isTruncated: false,
  };
};

