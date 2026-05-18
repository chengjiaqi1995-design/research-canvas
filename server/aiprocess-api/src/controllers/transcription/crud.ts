import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma, { ensureDBConnected } from '../../utils/db';
import { deleteFile } from '../../services/storageService';
import { transcriptionQueue, postProcessQueue } from '../../services/transcriptionQueue';
import type {
  ApiResponse,
  PaginatedResponse,
  AIProvider,
} from '../../types';
import { performTranscription, performPostProcessing } from './helpers';
import fs from 'fs';

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

const NOTE_TYPE_PATTERNS: Record<string, string[]> = {
  earnings: ['earnings', 'earning', 'company', '公司点评', '业绩', '业绩点评', '财报'],
  management: ['management', 'mgmt', '管理层'],
  buyside: ['buyside', 'buy-side', '买方', '买方研究', '买方访谈'],
  sellside: ['sellside', '卖方', '卖方研报'],
  expert: ['expert', 'experts', '专家', '专家访谈'],
};

const GENERATION_METHODS = new Set(['merged_text', 'audio_upload', 'podcast', 'manual_note', 'ai_generated']);

function parseCsvParam(raw: unknown): string[] {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (part) => `\\${part}`)}%`;
}

function buildAnyIlike(fields: Prisma.Sql[], patterns: string[]): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  for (const pattern of patterns) {
    for (const field of fields) {
      clauses.push(Prisma.sql`${field} ILIKE ${pattern} ESCAPE '\\'`);
    }
  }
  return Prisma.sql`(${Prisma.join(clauses, ' OR ')})`;
}

function buildSearchScore(patterns: string[]): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  patterns.forEach((pattern, index) => {
    const primary = index === 0;
    clauses.push(
      Prisma.sql`CASE WHEN t."fileName" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 120 : 36} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."topic" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 100 : 30} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."organization" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 90 : 27} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."speaker" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 70 : 21} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."industry" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 60 : 18} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."intermediary" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 50 : 15} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."summary" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 30 : 9} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."translatedSummary" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 30 : 9} ELSE 0 END`,
      Prisma.sql`CASE WHEN t."transcriptText" ILIKE ${pattern} ESCAPE '\\' THEN ${primary ? 10 : 3} ELSE 0 END`
    );
  });
  return clauses.length ? Prisma.sql`(${Prisma.join(clauses, ' + ')})` : Prisma.sql`0`;
}

function buildGenerationMethodCondition(method: string): Prisma.Sql | null {
  const searchable = Prisma.sql`concat_ws(' ', t."type", t."fileName", t."filePath", t."tags")`;
  switch (method) {
    case 'podcast':
      return buildAnyIlike([searchable], [escapeLikePattern('podcast'), escapeLikePattern('podwise'), escapeLikePattern('播客')]);
    case 'merged_text':
      return Prisma.sql`(t."type" = 'merge' OR ${buildAnyIlike([searchable], [escapeLikePattern('skill-merge'), escapeLikePattern('合并')])})`;
    case 'manual_note':
      return Prisma.sql`t."type" = 'note'`;
    case 'ai_generated':
      return Prisma.sql`(t."type" IN ('weekly-summary', 'daily-summary') OR ${buildAnyIlike([searchable], [escapeLikePattern('ai-generated'), escapeLikePattern('ai生成')])})`;
    case 'audio_upload':
      return Prisma.sql`(
        COALESCE(t."type", 'transcription') NOT IN ('merge', 'weekly-summary', 'daily-summary', 'note')
        AND NOT ${buildAnyIlike([searchable], [
          escapeLikePattern('podcast'),
          escapeLikePattern('podwise'),
          escapeLikePattern('播客'),
          escapeLikePattern('skill-merge'),
          escapeLikePattern('合并'),
          escapeLikePattern('ai-generated'),
          escapeLikePattern('ai生成'),
        ])}
      )`;
    default:
      return null;
  }
}

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

  // 获取API密钥（必须由客户端提供，不再回退到环境变量）
  let apiKey: string | undefined = undefined;
  if (aiProvider === 'qwen') {
    apiKey = req.body.qwenApiKey && !req.body.qwenApiKey.includes('****') ? req.body.qwenApiKey : undefined;
  } else if (aiProvider === 'gemini') {
    apiKey = req.body.geminiApiKey && !req.body.geminiApiKey.includes('****') ? req.body.geminiApiKey : undefined;
  }

  if (!apiKey) {
    return res.status(400).json({
      success: false,
      error: '请在设置中配置 API 密钥后再使用此功能',
    } as ApiResponse);
  }

  // 获取自定义 Prompt（从前端传递）
  const customPrompt = req.body.customPrompt;
  const metadataFillPrompt = req.body.metadataFillPrompt;
  const providerKeys = parseProviderKeys(req.body.providerKeys);

  // 获取千问模型参数（仅对千问有效）
  const qwenModel = aiProvider === 'qwen' ? (req.body.qwenModel || 'paraformer-v2') : undefined;

  // 具体模型名用于存储（如 paraformer-v2, qwen3-asr-flash-filetrans, gemini-3-flash-preview）
  const specificModel = aiProvider === 'qwen'
    ? (qwenModel || 'paraformer-v2')
    : req.body.transcriptionModel;

  // 创建转录记录
  const userId = req.userId!; // 认证中间件已确保 userId 存在
  const transcription = await prisma.transcription.create({
    data: {
      fileName: decodedFileName,
      filePath: fileUrl, // 使用 GCS URL
      fileSize: file.size,
      aiProvider: specificModel,
      status: 'pending',
      userId, // 关联到当前用户
    },
  });

  // 流水线处理：Phase1 转录（DashScope队列，并发2）→ 完成后 Phase2 后处理（Gemini队列，并发2）
  const geminiApiKey = req.body.geminiApiKey;
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
        // 如果前端未传 customPrompt 和 metadataFillPrompt，跳过后处理直接完成
        if (!customPrompt && !metadataFillPrompt) {
          await prisma.transcription.update({
            where: { id: tid },
            data: { status: 'completed', processingStep: null },
          }).catch(() => {});
          console.log(`✅ [Phase1] 转录完成（已跳过后处理）: ${tid}`);
        } else {
          postProcessQueue.enqueue(
            () => performPostProcessing(tid, result.transcriptText, result.transcriptTextJson, geminiApiKey, customPrompt, modelConfig.summaryModel, modelConfig.metadataModel, metadataFillPrompt, providerKeys),
            `后处理: ${tid}`,
            async () => {
              await prisma.transcription.updateMany({
                where: { id: tid, status: 'processing' },
                data: { status: 'failed', errorMessage: '后处理超时（10分钟）', processingStep: null },
              }).catch(() => {});
            }
          );
        }
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
    metadataFillPrompt,
    storageType,
    transcriptionModel,
    summaryModel,
    metadataModel,
    providerKeys,
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

  // 获取 API 密钥（必须由客户端提供，不再回退到环境变量）
  let apiKey: string | undefined = undefined;
  if (aiProvider === 'qwen') {
    apiKey = qwenApiKey && !qwenApiKey.includes('****') ? qwenApiKey : undefined;
  } else if (aiProvider === 'gemini') {
    apiKey = geminiApiKey && !geminiApiKey.includes('****') ? geminiApiKey : undefined;
  }

  if (!apiKey) {
    return res.status(400).json({
      success: false,
      error: '请在设置中配置 API 密钥后再使用此功能',
    } as ApiResponse);
  }

  // 确定千问模型
  const selectedQwenModel = aiProvider === 'qwen' ? (qwenModel || 'paraformer-v2') : undefined;

  // 具体模型名用于存储
  const specificModel = aiProvider === 'qwen'
    ? (selectedQwenModel || 'paraformer-v2')
    : transcriptionModel;

  // 创建转录记录
  const userId = req.userId!;
  const transcription = await prisma.transcription.create({
    data: {
      fileName,
      filePath: fileUrl,
      fileSize: fileSize || 0,
      aiProvider: specificModel,
      status: 'pending',
      userId,
    },
  });

  // 流水线处理：Phase1 转录（DashScope队列，并发2）→ 完成后 Phase2 后处理（Gemini队列，并发2）
  const geminiApiKeyForSummary = geminiApiKey;
  const tid = transcription.id;
  transcriptionQueue.enqueue(
    async () => {
      const result = await performTranscription(tid, fileUrl, aiProvider, apiKey, selectedQwenModel, transcriptionModel);
      if (result) {
        // 如果前端未传 customPrompt 和 metadataFillPrompt，跳过后处理直接完成
        if (!customPrompt && !metadataFillPrompt) {
          await prisma.transcription.update({
            where: { id: tid },
            data: { status: 'completed', processingStep: null },
          }).catch(() => {});
          console.log(`✅ [Phase1] 转录完成（已跳过后处理）: ${tid}`);
        } else {
          postProcessQueue.enqueue(
            () => performPostProcessing(tid, result.transcriptText, result.transcriptTextJson, geminiApiKeyForSummary, customPrompt, summaryModel, metadataModel, metadataFillPrompt, parseProviderKeys(providerKeys)),
            `后处理: ${tid}`,
            async () => {
              await prisma.transcription.updateMany({
                where: { id: tid, status: 'processing' },
                data: { status: 'failed', errorMessage: '后处理超时（10分钟）', processingStep: null },
              }).catch(() => {});
            }
          );
        }
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
  await ensureDBConnected();

  const userId = req.userId!;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const skip = (page - 1) * pageSize;
  const search = String(req.query.search || '').trim();
  const includeContent = req.query.includeContent === '1' || req.query.includeContent === 'true';
  const noteTypes = parseCsvParam(req.query.noteTypes)
    .filter((value) => Object.prototype.hasOwnProperty.call(NOTE_TYPE_PATTERNS, value));
  const generationMethods = parseCsvParam(req.query.generationMethods)
    .filter((value) => GENERATION_METHODS.has(value));
  const onlyUnsynced = req.query.unsynced === '1' || req.query.unsynced === 'true';

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
  if (onlyUnsynced) {
    where.lastSyncedAt = null;
  }
  if (search) {
    const containsSearch = { contains: search, mode: 'insensitive' };
    where.OR = [
      { fileName: containsSearch },
      { topic: containsSearch },
      { organization: containsSearch },
      { intermediary: containsSearch },
      { industry: containsSearch },
      { country: containsSearch },
      { participants: containsSearch },
      { eventDate: containsSearch },
      { speaker: containsSearch },
      { summary: containsSearch },
      { translatedSummary: containsSearch },
      { transcriptText: containsSearch },
    ];
  }
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
      const tagFilter = [
        { tags: null },
        { tags: '' },
        { tags: '[]' },
      ];
      where.AND = [...(where.AND || []), { OR: tagFilter }];
    } else {
      // 包含指定标签（tags 是 JSON 字符串数组）
      where.tags = { contains: tag };
    }
  }
  if (noteTypes.length > 0) {
    const noteTypeOr = noteTypes.flatMap((noteType) => {
      const patterns = NOTE_TYPE_PATTERNS[noteType] || [];
      return patterns.flatMap((pattern) => ([
        { participants: { contains: pattern, mode: 'insensitive' } },
        { tags: { contains: pattern, mode: 'insensitive' } },
      ]));
    });
    if (noteTypeOr.length > 0) {
      where.AND = [...(where.AND || []), { OR: noteTypeOr }];
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

  const listSelect = {
    id: true,
    fileName: true,
    filePath: true,
    fileSize: true,
    duration: true,
    aiProvider: true,
    status: true,
    processingStep: true,
    errorMessage: true,
    tags: true,
    actualDate: true,
    projectId: true,
    type: true,
    topic: true,
    organization: true,
    intermediary: true,
    industry: true,
    country: true,
    participants: true,
    eventDate: true,
    speaker: true,
    lastSyncedAt: true,
    createdAt: true,
    updatedAt: true,
    project: {
      select: {
        id: true,
        name: true,
      },
    },
  };

  let items: any[];
  let total: number;

  if (!includeContent) {
    const rawConditions: Prisma.Sql[] = [Prisma.sql`t."userId" = ${userId}`];
    if (onlyUnsynced) {
      rawConditions.push(Prisma.sql`t."lastSyncedAt" IS NULL`);
    }
    if (projectId) {
      rawConditions.push(projectId === 'null' || projectId === ''
        ? Prisma.sql`t."projectId" IS NULL`
        : Prisma.sql`t."projectId" = ${projectId}`);
    }
    if (tag) {
      if (tag === 'null' || tag === '') {
        rawConditions.push(Prisma.sql`(t."tags" IS NULL OR t."tags" = '' OR t."tags" = '[]')`);
      } else {
        rawConditions.push(buildAnyIlike([Prisma.sql`t."tags"`], [escapeLikePattern(tag)]));
      }
    }
    if (noteTypes.length > 0) {
      const noteTypeConditions = noteTypes
        .map((noteType) => NOTE_TYPE_PATTERNS[noteType] || [])
        .filter((patterns) => patterns.length > 0)
        .map((patterns) => buildAnyIlike(
          [Prisma.sql`t."participants"`, Prisma.sql`t."tags"`],
          patterns.map(escapeLikePattern)
        ));
      if (noteTypeConditions.length > 0) {
        rawConditions.push(Prisma.sql`(${Prisma.join(noteTypeConditions, ' OR ')})`);
      }
    }
    if (generationMethods.length > 0) {
      const methodConditions = generationMethods
        .map(buildGenerationMethodCondition)
        .filter((condition): condition is Prisma.Sql => Boolean(condition));
      if (methodConditions.length > 0) {
        rawConditions.push(Prisma.sql`(${Prisma.join(methodConditions, ' OR ')})`);
      }
    }

    const searchFields = [
      Prisma.sql`t."fileName"`,
      Prisma.sql`t."topic"`,
      Prisma.sql`t."organization"`,
      Prisma.sql`t."intermediary"`,
      Prisma.sql`t."industry"`,
      Prisma.sql`t."country"`,
      Prisma.sql`t."participants"`,
      Prisma.sql`t."eventDate"`,
      Prisma.sql`t."speaker"`,
      Prisma.sql`t."summary"`,
      Prisma.sql`t."translatedSummary"`,
      Prisma.sql`t."transcriptText"`,
    ];
    const searchTokens = search
      ? search.split(/\s+/).map((token) => token.trim()).filter(Boolean).slice(0, 8)
      : [];
    const searchPatterns = Array.from(new Set([
      ...(search ? [escapeLikePattern(search)] : []),
      ...searchTokens.map(escapeLikePattern),
    ]));
    if (searchPatterns.length > 0) {
      rawConditions.push(Prisma.sql`(${Prisma.join(searchTokens.map((token) => (
        buildAnyIlike(searchFields, [escapeLikePattern(token)])
      )), ' AND ')})`);
    }

    const whereSql = Prisma.sql`WHERE ${Prisma.join(rawConditions, ' AND ')}`;
    const searchScoreSql = buildSearchScore(searchPatterns);
    const sortDirection = sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const orderSql = search
      ? Prisma.sql`"searchScore" DESC, t."createdAt" DESC`
      : sortBy === 'actualDate'
        ? Prisma.sql`t."actualDate" ${sortDirection} NULLS LAST, t."createdAt" ${sortDirection}`
        : Prisma.sql`t."createdAt" ${sortDirection}`;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        t."id",
        t."fileName",
        t."filePath",
        t."fileSize",
        t."duration",
        t."aiProvider",
        t."status",
        t."processingStep",
        t."errorMessage",
        t."tags",
        t."actualDate",
        t."projectId",
        t."type",
        t."topic",
        t."organization",
        t."intermediary",
        t."industry",
        t."country",
        t."participants",
        t."eventDate",
        t."speaker",
        t."lastSyncedAt",
        t."createdAt",
        t."updatedAt",
        p."id" AS "project_id",
        p."name" AS "project_name",
        ${searchScoreSql} AS "searchScore"
      FROM "Transcription" t
      LEFT JOIN "Project" p ON p."id" = t."projectId"
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${pageSize}
      OFFSET ${skip}
    `;
    items = rows.map(({ project_id, project_name, ...row }) => ({
      ...row,
      searchScore: typeof row.searchScore === 'bigint' ? Number(row.searchScore) : row.searchScore,
      project: project_id ? { id: project_id, name: project_name } : null,
    }));
    const countRows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
      SELECT COUNT(*)::int AS "count"
      FROM "Transcription" t
      ${whereSql}
    `;
    total = Number(countRows[0]?.count || 0);
  } else {
    [items, total] = await Promise.all([
      (prisma.transcription.findMany as any)({
        where,
        skip,
        take: pageSize,
        orderBy,
        ...(includeContent ? {
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        } : {
          select: listSelect,
        }),
      }),
      prisma.transcription.count({ where }),
    ]);
  }

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
    if ((item.type === 'merge' || item.type === 'weekly-summary' || item.type === 'daily-summary') && item.mergeSources) {
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
      transcriptText: item.transcriptText || '',
      summary: item.summary || '',
      translatedSummary: item.translatedSummary || '',
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
  if ((transcriptionAny.type === 'merge' || transcriptionAny.type === 'weekly-summary' || transcriptionAny.type === 'daily-summary') && transcriptionAny.mergeSources) {
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
