import { Request, Response } from 'express';
import prisma from '../../utils/db';
import { deleteFile } from '../../services/storageService';
import { transcriptionQueue, postProcessQueue } from '../../services/transcriptionQueue';
import type {
  ApiResponse,
  PaginatedResponse,
  AIProvider,
} from '../../types';
import { performTranscription, performPostProcessing } from './helpers';
import fs from 'fs';

/**
 * 创建转录
 */
export async function createTranscription(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({
      success: false,
      error: '请上传音频文件',
    } as ApiResponse);
  }

  // 解码文件名（Multer 使用 Latin-1 编码，需要转换为 UTF-8）
  let decodedFileName = file.originalname;
  try {
    // 尝试将 Latin-1 编码的字符串转换为 UTF-8
    decodedFileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // 如果转换后仍有乱码（通常是因为原本就是正确的 UTF-8），则使用原始名称
    if (decodedFileName.includes('�')) {
      decodedFileName = file.originalname;
    }
  } catch (e) {
    console.warn('文件名解码失败，使用原始名称:', e);
    decodedFileName = file.originalname;
  }

  // 记录文件信息
  console.log('📁 上传的文件信息:', {
    originalname: file.originalname,
    decodedFileName: decodedFileName,
    filename: file.filename,
    path: file.path,
    size: file.size,
    mimetype: file.mimetype,
  });

  // 文件已上传到 GCS，file.path 包含 GCS URL
  const fileUrl = file.path || (file as any).gcsUrl;
  console.log('📁 文件 GCS URL:', fileUrl);

  if (!fileUrl) {
    console.error('❌ 文件 URL 不存在');
    return res.status(400).json({
      success: false,
      error: '文件上传失败，未获取到文件 URL',
    } as ApiResponse);
  }

  const aiProvider = req.body.aiProvider as AIProvider;
  if (!aiProvider || !['gemini', 'qwen'].includes(aiProvider)) {
    return res.status(400).json({
      success: false,
      error: '请选择有效的 AI 服务提供商',
    } as ApiResponse);
  }

  // 获取API密钥（优先使用客户端传入的，否则使用环境变量）
  let apiKey: string | undefined = undefined;
  if (aiProvider === 'qwen') {
    const clientKey = req.body.qwenApiKey && !req.body.qwenApiKey.includes('****') ? req.body.qwenApiKey : undefined;
    apiKey = clientKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || undefined;
  } else if (aiProvider === 'gemini') {
    const clientKey = req.body.geminiApiKey && !req.body.geminiApiKey.includes('****') ? req.body.geminiApiKey : undefined;
    apiKey = clientKey || process.env.GEMINI_API_KEY || undefined;
  }

  // 获取自定义 Prompt（从前端传递）
  const customPrompt = req.body.customPrompt;

  // 获取千问模型参数（仅对千问有效）
  const qwenModel = aiProvider === 'qwen' ? (req.body.qwenModel || 'paraformer-v2') : undefined;

  // 创建转录记录
  const userId = req.userId!; // 认证中间件已确保 userId 存在
  const transcription = await prisma.transcription.create({
    data: {
      fileName: decodedFileName,
      filePath: fileUrl, // 使用 GCS URL
      fileSize: file.size,
      aiProvider,
      status: 'pending',
      userId, // 关联到当前用户
    },
  });

  // 流水线处理：Phase1 转录（DashScope队列，并发2）→ 完成后 Phase2 后处理（Gemini队列，并发2）
  const geminiApiKey = req.body.geminiApiKey || process.env.GEMINI_API_KEY;
  const modelConfig = {
    transcriptionModel: req.body.transcriptionModel,
    summaryModel: req.body.summaryModel,
    metadataModel: req.body.metadataModel,
  };
  const tid = transcription.id;
  transcriptionQueue.enqueue(
    async () => {
      const result = await performTranscription(tid, fileUrl, aiProvider, apiKey, qwenModel, modelConfig.transcriptionModel);
      if (result) {
        postProcessQueue.enqueue(
          () => performPostProcessing(tid, result.transcriptText, result.transcriptTextJson, geminiApiKey, customPrompt, modelConfig.summaryModel, modelConfig.metadataModel),
          `后处理: ${tid}`,
          async () => {
            await prisma.transcription.updateMany({
              where: { id: tid, status: 'processing' },
              data: { status: 'failed', errorMessage: '后处理超时（10分钟）', processingStep: null },
            }).catch(() => {});
          }
        );
      }
    },
    `转录: ${tid}`,
    async () => {
      await prisma.transcription.updateMany({
        where: { id: tid, status: { in: ['pending', 'processing'] } },
        data: { status: 'failed', errorMessage: '转录超时（10分钟）', processingStep: null },
      }).catch(() => {});
    }
  );

  return res.status(201).json({
    success: true,
    data: transcription,
    message: '转录任务已创建，排队等待处理',
  } as ApiResponse);
}

/**
 * 通过文件 URL 创建转录（用于 Signed URL 直传方案）
 * 前端先将文件直传到云存储，然后调用此 API 传递文件 URL
 */
export async function createTranscriptionFromUrl(req: Request, res: Response) {
  const {
    fileUrl,
    fileName,
    fileSize,
    aiProvider,
    qwenApiKey,
    geminiApiKey,
    qwenModel,
    customPrompt,
    storageType,
    transcriptionModel,
    summaryModel,
    metadataModel,
  } = req.body;

  // 验证必填参数
  if (!fileUrl || typeof fileUrl !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少文件 URL 参数',
    } as ApiResponse);
  }

  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少文件名参数',
    } as ApiResponse);
  }

  if (!aiProvider || !['gemini', 'qwen'].includes(aiProvider)) {
    return res.status(400).json({
      success: false,
      error: '请选择有效的 AI 服务提供商',
    } as ApiResponse);
  }

  console.log('📁 通过 URL 创建转录:', {
    fileUrl,
    fileName,
    fileSize,
    aiProvider,
    qwenModel,
    storageType,
  });

  // 获取 API 密钥
  let apiKey: string | undefined = undefined;
  if (aiProvider === 'qwen') {
    // Skip masked keys (contain ****) from frontend - they are not real API keys
    const validQwenKey = qwenApiKey && !qwenApiKey.includes('****') ? qwenApiKey : undefined;
    apiKey = validQwenKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || undefined;
    console.log('🔑 最终使用的 API key:', {
      source: qwenApiKey ? 'frontend' : process.env.QWEN_API_KEY ? 'QWEN_API_KEY env' : 'DASHSCOPE_API_KEY env',
      keyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : '(none)',
      keyLength: apiKey ? apiKey.length : 0,
    });
  } else if (aiProvider === 'gemini') {
    const validGeminiKey = geminiApiKey && !geminiApiKey.includes('****') ? geminiApiKey : undefined;
    apiKey = validGeminiKey || process.env.GEMINI_API_KEY || undefined;
  }

  // 确定千问模型
  const selectedQwenModel = aiProvider === 'qwen' ? (qwenModel || 'paraformer-v2') : undefined;

  // 创建转录记录
  const userId = req.userId!;
  const transcription = await prisma.transcription.create({
    data: {
      fileName,
      filePath: fileUrl,
      fileSize: fileSize || 0,
      aiProvider,
      status: 'pending',
      userId,
    },
  });

  // 流水线处理：Phase1 转录（DashScope队列，并发2）→ 完成后 Phase2 后处理（Gemini队列，并发2）
  const geminiApiKeyForSummary = geminiApiKey || process.env.GEMINI_API_KEY;
  const tid = transcription.id;
  transcriptionQueue.enqueue(
    async () => {
      const result = await performTranscription(tid, fileUrl, aiProvider, apiKey, selectedQwenModel, transcriptionModel);
      if (result) {
        postProcessQueue.enqueue(
          () => performPostProcessing(tid, result.transcriptText, result.transcriptTextJson, geminiApiKeyForSummary, customPrompt, summaryModel, metadataModel),
          `后处理: ${tid}`,
          async () => {
            await prisma.transcription.updateMany({
              where: { id: tid, status: 'processing' },
              data: { status: 'failed', errorMessage: '后处理超时（10分钟）', processingStep: null },
            }).catch(() => {});
          }
        );
      }
    },
    `转录: ${tid}`,
    async () => {
      await prisma.transcription.updateMany({
        where: { id: tid, status: { in: ['pending', 'processing'] } },
        data: { status: 'failed', errorMessage: '转录超时（10分钟）', processingStep: null },
      }).catch(() => {});
    }
  );

  return res.status(201).json({
    success: true,
    data: transcription,
    message: '转录任务已创建，排队等待处理',
  } as ApiResponse);
}

/**
 * 获取转录列表
 */
export async function getTranscriptions(req: Request, res: Response) {
  const userId = req.userId!;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const skip = (page - 1) * pageSize;

  // 排序方式：'createdAt' (导入日期) 或 'actualDate' (实际日期)
  const sortBy = (req.query.sortBy as string) || 'createdAt';
  const sortOrder = (req.query.sortOrder as string) || 'desc';

  // 项目筛选
  const projectId = req.query.projectId as string | undefined;
  // 标签筛选
  const tag = req.query.tag as string | undefined;

  const where: any = {
    userId, // 只获取当前用户的数据
  };
  if (projectId) {
    if (projectId === 'null' || projectId === '') {
      where.projectId = null;
    } else {
      where.projectId = projectId;
    }
  }
  if (tag) {
    if (tag === 'null' || tag === '') {
      // 未分类：tags 为空或为 null 或为 "[]"
      where.OR = [
        { tags: null },
        { tags: '' },
        { tags: '[]' },
      ];
    } else {
      // 包含指定标签（tags 是 JSON 字符串数组）
      where.tags = { contains: tag };
    }
  }

  let orderBy: any;
  if (sortBy === 'actualDate') {
    // 按实际日期排序，使用多字段排序：先按 actualDate，再按 createdAt
    // nulls_last 确保 null 值排在最后
    orderBy = [
      { actualDate: { sort: sortOrder === 'asc' ? 'asc' : 'desc', nulls: 'last' } },
      { createdAt: sortOrder === 'asc' ? 'asc' : 'desc' },
    ];
  } else {
    orderBy = { createdAt: sortOrder === 'asc' ? 'asc' : 'desc' };
  }

  const [items, total] = await Promise.all([
    (prisma.transcription.findMany as any)({
      where,
      skip,
      take: pageSize,
      orderBy,
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.transcription.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  // 解析 tags 和 mergeSources，填充 actualDate
  const parsedItems = items.map((item: any) => {
    let parsedTags: string[] = [];
    try {
      parsedTags = JSON.parse(item.tags) as string[];
    } catch (e) {
      console.warn('Failed to parse tags for transcription:', item.id, e);
    }
    let parsedMergeSources: Array<{ id: string; title: string; content: string }> = [];
    if ((item.type === 'merge' || item.type === 'weekly-summary') && item.mergeSources) {
      try {
        parsedMergeSources = JSON.parse(item.mergeSources) as Array<{ id: string; title: string; content: string }>;
      } catch (e) {
        console.warn('Failed to parse mergeSources for transcription:', item.id, e);
      }
    }

    // 如果没有 actualDate，使用 eventDate 或 createdAt 作为默认值
    let effectiveActualDate = item.actualDate;
    if (!effectiveActualDate) {
      if (item.eventDate && item.eventDate !== '未提及') {
        // eventDate 是字符串格式如 "2025/12/20"，转换为 Date
        effectiveActualDate = new Date(item.eventDate);
      } else {
        effectiveActualDate = item.createdAt;
      }
    }

    return {
      ...item,
      actualDate: effectiveActualDate,
      tags: parsedTags,
      mergeSources: parsedMergeSources,
      // 🧼 后端强力清洗：participants 字段只保留字母
      participants: item.participants ? item.participants.replace(/[^a-zA-Z]/g, '') : null,
    };
  });

  return res.json({
    success: true,
    data: {
      items: parsedItems,
      total,
      page,
      pageSize,
      totalPages,
    } as PaginatedResponse<any>,
  } as ApiResponse);
}

/**
 * 获取 Directory 页面数据（轻量级，只返回元数据字段）
 */
export async function getDirectoryData(req: Request, res: Response) {
  const userId = req.userId!;
  const tag = req.query.tag as string | undefined;

  const where: any = {
    userId,
    status: 'completed',
  };

  if (tag) {
    if (tag === 'null' || tag === '') {
      where.OR = [
        { tags: null },
        { tags: '' },
        { tags: '[]' },
      ];
    } else {
      where.tags = { contains: tag };
    }
  }

  const items = await prisma.transcription.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      organization: true,
      industry: true,
      country: true,
      participants: true,
      eventDate: true,
      actualDate: true,
      createdAt: true,
      tags: true,
      topic: true,
      type: true,
      status: true,
    },
  });

  // 解析 tags 和清洗 participants
  const parsedItems = items.map((item: any) => {
    let parsedTags: string[] = [];
    try {
      parsedTags = JSON.parse(item.tags) as string[];
    } catch (e) {
      // ignore
    }

    return {
      ...item,
      tags: parsedTags,
      participants: item.participants ? item.participants.replace(/[^a-zA-Z]/g, '') : null,
    };
  });

  return res.json({
    success: true,
    data: {
      items: parsedItems,
      total: parsedItems.length,
    },
  } as ApiResponse);
}

/**
 * 获取单个转录
 */
export async function getTranscription(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  // ⚠️ 安全检查：确保只能访问自己的数据
  const transcription = await prisma.transcription.findFirst({
    where: {
      id,
      userId, // 只允许访问当前用户的数据
    },
  });

  if (!transcription) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在或无权限访问',
    } as ApiResponse);
  }

  // 解析 tags 和 mergeSources
  const transcriptionAny = transcription as any;
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(transcriptionAny.tags || '[]') as string[];
  } catch (e) {
    console.warn('Failed to parse tags for transcription:', id, e);
  }
  let parsedMergeSources: Array<{ id: string; title: string; content: string }> = [];
  if ((transcriptionAny.type === 'merge' || transcriptionAny.type === 'weekly-summary') && transcriptionAny.mergeSources) {
    try {
      parsedMergeSources = JSON.parse(transcriptionAny.mergeSources) as Array<{ id: string; title: string; content: string }>;
    } catch (e) {
      console.warn('Failed to parse mergeSources for transcription:', id, e);
    }
  }

  return res.json({
    success: true,
    data: {
      ...transcription,
      tags: parsedTags,
      mergeSources: parsedMergeSources,
    } as any,
  } as ApiResponse);
}

/**
 * 删除转录
 */
export async function deleteTranscription(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const transcription = await prisma.transcription.findFirst({
    where: {
      id,
      userId, // 确保只能删除自己的数据
    },
  });

  if (!transcription) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 删除文件（GCS 或本地）
  if (transcription.filePath) {
    try {
      // 判断是 OSS 还是 GCS
      if (transcription.filePath.startsWith('http://') || transcription.filePath.startsWith('https://')) {
        if (transcription.filePath.includes('aliyuncs.com')) {
          const { deleteFileFromOSS } = await import('../../services/ossStorageService');
          await deleteFileFromOSS(transcription.filePath);
          console.log('🗑️ 已从 OSS 删除音频文件:', transcription.filePath);
        } else {
          await deleteFile(transcription.filePath);
          console.log('🗑️ 已从 GCS 删除音频文件:', transcription.filePath);
        }
      } else {
        // 本地文件（开发环境）
        if (fs.existsSync(transcription.filePath)) {
          fs.unlinkSync(transcription.filePath);
          console.log('🗑️ 已删除本地音频文件:', transcription.filePath);
        }
      }
    } catch (error: any) {
      console.error('删除音频文件错误:', error);
      // 继续执行，不因为文件删除失败而阻止记录删除
    }
  }

  // 删除记录
  await prisma.transcription.delete({
    where: { id },
  });

  return res.json({
    success: true,
    message: '删除成功',
  } as ApiResponse);
}

/**
 * 获取未同步到 Canvas 的已完成转录
 */
export async function getUnsyncedForCanvas(req: Request, res: Response) {
  const userId = req.userId!;

  const items = await prisma.transcription.findMany({
    where: {
      userId,
      status: 'completed',
      lastSyncedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      organization: true,
      industry: true,
      country: true,
      participants: true,
      intermediary: true,
      eventDate: true,
      actualDate: true,
      createdAt: true,
      tags: true,
      topic: true,
      type: true,
      summary: true,
      translatedSummary: true,
    },
  });

  const parsedItems = items.map((item: any) => {
    let parsedTags: string[] = [];
    try { parsedTags = JSON.parse(item.tags) as string[]; } catch { /* ignore */ }
    return {
      ...item,
      tags: parsedTags,
      participants: item.participants ? item.participants.replace(/[^a-zA-Z]/g, '') : null,
    };
  });

  return res.json({ success: true, data: { items: parsedItems, total: parsedItems.length } });
}

/**
 * 批量标记转录已同步到 Canvas
 */
export async function markSyncedToCanvas(req: Request, res: Response) {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ success: false, error: 'ids array required' });
  }

  await prisma.transcription.updateMany({
    where: { id: { in: ids } },
    data: { lastSyncedAt: new Date() },
  });

  return res.json({ success: true, updated: ids.length });
}
