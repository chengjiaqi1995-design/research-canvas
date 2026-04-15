import { Request, Response } from 'express';
import prisma, { reconnectDB } from '../../utils/db';
import { generateSummary } from '../../services/aiService';
import { generateWeeklySummary as generateWeeklySummaryService, getWeekBoundaries } from '../../services/weeklySummaryService';
import { ApiResponse, RegenerateSummaryRequest, AIProvider } from '../../types';
import { resolveProvider } from '../../services/ai';
// formatParticipantsForTitle no longer needed here (metadata extraction moved to frontend)

export async function regenerateSummary(req: Request, res: Response) {
  const { id } = req.params;
  const { aiProvider, customPrompt, action, summaryModel, metadataModel } = req.body as RegenerateSummaryRequest & { action?: 'summary' | 'metadata' | 'all'; summaryModel?: string; metadataModel?: string };
  const actionType = action || 'all';

  console.log(`🔄 开始重新生成，ID: ${id}，操作类型: ${actionType}`);
  console.log(`📝 自定义总结 Prompt: ${customPrompt ? '是' : '否'}`);
  console.log(`🤖 指定 AI 服务: ${aiProvider || '未指定'}`);

  const transcription = await prisma.transcription.findUnique({
    where: { id },
  });

  if (!transcription) {
    console.error(`❌ 转录记录不存在: ${id}`);
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  if (!transcription.transcriptText) {
    console.error(`❌ 转录文本为空: ${id}`);
    return res.status(400).json({
      success: false,
      error: '没有可用的转录文本',
    } as ApiResponse);
  }

  // 解析转录文本（可能是 JSON 格式）
  let transcriptTextForSummary: string;
  try {
    const parsed = JSON.parse(transcription.transcriptText);
    transcriptTextForSummary = parsed.text || transcription.transcriptText;
  } catch (e) {
    // 如果不是 JSON，直接使用
    transcriptTextForSummary = transcription.transcriptText;
  }

  console.log(`📄 转录文本长度: ${transcriptTextForSummary.length} 字符`);

  // 使用指定的 AI 服务或原有服务（DB 中可能存的是模型名，需 resolveProvider）
  const provider = resolveProvider(aiProvider || transcription.aiProvider || 'gemini');
  console.log(`🤖 使用 AI 服务: ${provider}`);

  // 获取 API 密钥（必须由客户端提供，不再回退到环境变量）
  let apiKey: string | undefined = undefined;
  if (provider === 'qwen') {
    apiKey = req.body.qwenApiKey;
  } else if (provider === 'gemini') {
    apiKey = req.body.geminiApiKey;
  }

  if (!apiKey) {
    console.error(`❌ API 密钥未设置，服务: ${provider}`);
    return res.status(400).json({
      success: false,
      error: '请在设置中配置 API 密钥后再使用此功能',
    } as ApiResponse);
  }

  console.log(`🔑 API 密钥: ${apiKey.substring(0, 10)}...`);

  let summary = transcription.summary || '';

  // 根据 actionType 执行不同操作（元数据提取已移至前端 AI 填充按钮）
  if (actionType === 'metadata') {
    return res.status(400).json({
      success: false,
      error: '元数据提取已改为前端操作，请使用"AI 填充"按钮',
    } as ApiResponse);
  }

  console.log(`⏳ 开始调用 AI 服务生成总结...`);
  summary = await generateSummary(transcriptTextForSummary, provider, apiKey, customPrompt, summaryModel);
  console.log(`✅ 总结生成成功，长度: ${summary.length} 字符`);

  // AI 调用后重连数据库，防止长时间空闲导致连接断开
  await reconnectDB();

  // 构建更新数据（仅总结，元数据由前端 AI 填充）
  const updateData: any = {
    status: 'completed',
    errorMessage: null,
    summary,
  };

  // 更新记录
  const updatedTranscription = await prisma.transcription.update({
    where: { id },
    data: updateData,
  });

  console.log(`✅ 数据库更新成功，ID: ${id}，状态已改为 completed`);

  const actionMessage = '总结重新生成成功';

  return res.json({
    success: true,
    data: updatedTranscription,
    message: actionMessage,
  } as ApiResponse);
}

export async function generateWeeklySummaryController(req: Request, res: Response) {
  const userId = req.userId!;
  const { weekStart: weekStartStr, weekEnd: weekEndStr, customPrompt, geminiApiKey, weeklySummaryModel } = req.body as {
    weekStart?: string;
    weekEnd?: string;
    customPrompt?: string;
    geminiApiKey?: string;
    weeklySummaryModel?: string;
  };

  // 1. 计算周边界（支持自定义结束日期）
  const { weekStart, weekEnd } = weekEndStr
    ? { weekStart: (() => { const d = new Date(weekStartStr || new Date()); d.setHours(0,0,0,0); return d; })(), weekEnd: (() => { const d = new Date(weekEndStr); d.setHours(23,59,59,999); return d; })() }
    : getWeekBoundaries(weekStartStr);
  const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  console.log(`📅 用户 ${userId} 请求生成周报: ${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`);

  // 2. 检查是否已存在该周的周报
  const existing = await prisma.transcription.findFirst({
    where: {
      userId,
      type: 'weekly-summary',
      actualDate: {
        gte: weekStart,
        lt: new Date(weekStart.getTime() + 24 * 60 * 60 * 1000), // weekStart 当天
      },
    },
  });

  // 统计已有版本数，生成版本号
  const existingCount = await prisma.transcription.count({
    where: {
      userId,
      type: 'weekly-summary',
      actualDate: {
        gte: weekStart,
        lt: new Date(weekStart.getTime() + 24 * 60 * 60 * 1000),
      },
    },
  });

  // 3. 调用 service 生成周报
  const result = await generateWeeklySummaryService(userId, weekStartStr, customPrompt, geminiApiKey, weeklySummaryModel, weekEndStr);

  // 4. 存储为 Transcription 记录（type='weekly-summary'）
  const versionSuffix = existingCount > 0 ? ` (v${existingCount + 1})` : '';
  const fileName = `周报 ${formatDate(weekStart)} ~ ${formatDate(weekEnd)}${versionSuffix}`;
  const transcriptData = JSON.stringify({
    weekStart: formatDate(weekStart),
    weekEnd: formatDate(weekEnd),
    highlights: result.highlights,
    benchmark: result.benchmark,
    metadata: result.metadata,
    customPrompt: result.customPrompt,
    noteCount: result.sources.length,
    sources: result.sources.map(s => ({ id: s.id, title: s.title })),
    tokenStats: result.tokenStats,
  });
  const mergeSourcesJson = JSON.stringify(
    result.sources.map(s => ({ id: s.id, title: s.title, content: '' }))
  );

  const transcription = await prisma.transcription.create({
    data: {
      fileName,
      filePath: '',
      fileSize: 0,
      duration: null,
      aiProvider: 'gemini' as AIProvider,
      status: 'completed',
      transcriptText: transcriptData,
      summary: result.summaryHtml,
      type: 'weekly-summary',
      mergeSources: mergeSourcesJson,
      tags: '[]',
      topic: '周报',
      organization: null,
      industry: '周报',
      actualDate: weekStart,
      userId,
    } as any,
  });

  console.log(`✅ 周报生成成功: ${transcription.id}`);

  return res.status(201).json({
    success: true,
    data: { ...transcription, tokenStats: result.tokenStats },
    message: '周报生成成功',
  } as ApiResponse);
}

// ==================== 周报设置管理（Skill + Prompts） ====================

export async function getWeeklySettings(req: Request, res: Response) {
  const userId = req.userId!;
  const settings = await prisma.portfolioSettings.findUnique({
    where: { userId },
    select: { weeklySkillContent: true, weeklyUserPrompt: true, weeklySystemPrompt: true },
  });
  return res.json({
    success: true,
    data: {
      skillContent: settings?.weeklySkillContent || '',
      userPrompt: settings?.weeklyUserPrompt || '',
      systemPrompt: settings?.weeklySystemPrompt || '',
    },
  } as ApiResponse);
}

export async function updateWeeklySettings(req: Request, res: Response) {
  const userId = req.userId!;
  const { skillContent, userPrompt, systemPrompt } = req.body as {
    skillContent?: string;
    userPrompt?: string;
    systemPrompt?: string;
  };

  const updateData: Record<string, string> = {};
  if (typeof skillContent === 'string') updateData.weeklySkillContent = skillContent;
  if (typeof userPrompt === 'string') updateData.weeklyUserPrompt = userPrompt;
  if (typeof systemPrompt === 'string') updateData.weeklySystemPrompt = systemPrompt;

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ success: false, error: '没有有效的更新字段' } as ApiResponse);
  }

  await prisma.portfolioSettings.upsert({
    where: { userId },
    update: updateData,
    create: { userId, ...updateData },
  });

  return res.json({ success: true, message: '周报设置已更新' } as ApiResponse);
}
