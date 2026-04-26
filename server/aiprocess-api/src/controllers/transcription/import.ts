import { Request, Response } from 'express';
import { Transcription } from '@prisma/client';
import prisma from '../../utils/db';
import { ApiResponse, AIProvider } from '../../types';
import { generateSummaryAsync, performPostProcessing } from './helpers';
import { postProcessQueue } from '../../services/transcriptionQueue';

function parseProviderKeys(raw: unknown): Record<string, string> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof raw === 'object' ? raw as Record<string, string> : undefined;
}

export async function createMergeHistory(req: Request, res: Response) {
  const userId = req.userId!; // 从认证中间件获取用户 ID
  const { fileName, summary, mergeSources, aiProvider } = req.body as {
    fileName: string;
    summary: string;
    mergeSources: Array<{ id: string; title: string; content: string }>;
    aiProvider?: string;
  };

  if (!fileName || !summary) {
    return res.status(400).json({
      success: false,
      error: '文件名和总结内容不能为空',
    } as ApiResponse);
  }

  // 将合并结果存储为 transcriptText（JSON 格式，与转录保持一致）
  const transcriptData = {
    text: summary,
    segments: [],
  };
  const transcriptTextJson = JSON.stringify(transcriptData);

  // 将合并源存储为 JSON
  const mergeSourcesJson = JSON.stringify(mergeSources || []);

  // 创建合并历史记录
  const transcription = await prisma.transcription.create({
    data: {
      fileName,
      filePath: '', // 合并类型没有文件路径
      fileSize: 0, // 合并类型没有文件大小
      duration: null, // 合并类型没有时长
      aiProvider: (aiProvider as AIProvider) || 'gemini',
      status: 'completed',
      transcriptText: transcriptTextJson,
      summary,
      type: 'merge',
      mergeSources: mergeSourcesJson,
      userId, // 关联到当前用户
    } as any,
  });

  return res.status(201).json({
    success: true,
    data: transcription,
    message: '合并历史保存成功',
  } as ApiResponse);
}

export async function createFromText(req: Request, res: Response) {
  const { text, sourceUrl, sourceTitle, geminiApiKey, customPrompt, metadataFillPrompt, summaryModel, providerKeys } = req.body;
  const userId = req.userId!; // 认证中间件已确保 userId 存在

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未授权',
    } as ApiResponse);
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: '文本内容不能为空',
    } as ApiResponse);
  }

  const trimmedText = text.trim();
  const parsedProviderKeys = parseProviderKeys(providerKeys);

  // 生成文件名：使用来源标题或文本前20个字符
  const fileName = sourceTitle
    ? `${sourceTitle.substring(0, 50)}`
    : `网页摘录-${trimmedText.substring(0, 20)}${trimmedText.length > 20 ? '...' : ''}`;

  // 是否要自动生成摘要和元数据（前端勾选 autoSummary 时会传 prompt）
  const hasSummaryKey = Boolean(
    geminiApiKey ||
    parsedProviderKeys?.google ||
    parsedProviderKeys?.dashscope ||
    parsedProviderKeys?.deepseek ||
    parsedProviderKeys?.openai
  );
  const shouldGenerateSummary = Boolean(hasSummaryKey && (customPrompt || metadataFillPrompt));

  // 创建转录记录（类型为 note）
  const transcription = await prisma.transcription.create({
    data: {
      fileName: fileName,
      filePath: sourceUrl || '',
      fileSize: Buffer.byteLength(trimmedText, 'utf8'),
      aiProvider: 'text',
      status: shouldGenerateSummary ? 'processing' : 'completed',
      processingStep: shouldGenerateSummary ? 'summarizing' : null,
      transcriptText: trimmedText,
      type: 'note',
      userId,
    } as any,
  });

  console.log(`📝 从文本创建笔记成功: ${transcription.id}, 来源: ${sourceUrl || '手动输入'}${shouldGenerateSummary ? '，将自动生成摘要 + 元数据' : ''}`);

  // 如果客户端传了 API key + prompt，走标准后处理流程（summary + metadata 一次调用）
  if (shouldGenerateSummary) {
    const transcriptTextJson = JSON.stringify({ text: trimmedText, segments: [] });
    postProcessQueue.enqueue(
      () => performPostProcessing(
        transcription.id,
        trimmedText,
        transcriptTextJson,
        geminiApiKey,
        customPrompt,
        summaryModel,
        undefined,
        metadataFillPrompt,
        parsedProviderKeys
      ),
      `笔记后处理: ${transcription.id}`,
      async () => {
        await prisma.transcription.updateMany({
          where: { id: transcription.id, status: 'processing' },
          data: { status: 'failed', errorMessage: '后处理超时（10分钟）', processingStep: null },
        }).catch(() => {});
      }
    );
  }

  return res.status(201).json({
    success: true,
    data: transcription,
  } as ApiResponse<Transcription>);
}

export async function importMarkdown(req: Request, res: Response) {
  const { notes } = req.body as {
    notes: Array<{ fileName: string; content: string }>
  };
  const userId = req.userId!;

  if (!notes || !Array.isArray(notes) || notes.length === 0) {
    return res.status(400).json({
      success: false,
      error: '请提供要导入的笔记内容',
    } as ApiResponse);
  }

  const createdNotes = [];

  for (const note of notes) {
    if (!note.content || typeof note.content !== 'string') continue;

    const trimmedContent = note.content.trim();
    if (trimmedContent.length === 0) continue;

    // 创建转录记录（类型为 note）
    const transcription = await prisma.transcription.create({
      data: {
        fileName: note.fileName || `导入笔记-${new Date().toLocaleDateString()}`,
        filePath: '', // 导入的笔记没有原始文件路径
        fileSize: Buffer.byteLength(trimmedContent, 'utf8'),
        aiProvider: 'text',
        status: 'completed',
        transcriptText: trimmedContent,
        type: 'note',
        userId,
      },
    });

    console.log(`📝 导入 MD 笔记成功: ${transcription.id}, 文件名: ${note.fileName}`);

    // 异步生成总结
    generateSummaryAsync(transcription.id, trimmedContent);

    createdNotes.push(transcription);
  }

  return res.status(201).json({
    success: true,
    data: createdNotes,
    message: `成功导入 ${createdNotes.length} 条笔记`,
  } as ApiResponse);
}
