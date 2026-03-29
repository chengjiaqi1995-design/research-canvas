import { Request, Response } from 'express';
import prisma from '../../utils/db';
import { enqueueTranscription } from '../../services/transcriptionQueue';
import { AIProvider, ApiResponse } from '../../types';
import { processTranscription } from './helpers';

/**
 * 强制重新处理转录
 */
export async function reprocessTranscription(req: Request, res: Response) {
  const { id } = req.params;
  const userId = req.userId!;

  console.log(`🔄 强制重新处理转录，ID: ${id}`);

  const transcription = await prisma.transcription.findUnique({
    where: { id },
  });

  if (!transcription) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  if (transcription.userId !== userId) {
    return res.status(403).json({
      success: false,
      error: '无权操作此转录记录',
    } as ApiResponse);
  }

  if (!transcription.filePath) {
    return res.status(400).json({
      success: false,
      error: '无法重新处理：原始音频文件路径不存在',
    } as ApiResponse);
  }

  // 重置状态为 processing
  const updated = await prisma.transcription.update({
    where: { id },
    data: {
      status: 'processing',
      errorMessage: null,
    },
  });

  // 重新入队处理
  const aiProvider = (transcription.aiProvider || 'gemini') as AIProvider;
  const geminiApiKey = req.body.geminiApiKey || process.env.GEMINI_API_KEY;
  const qwenApiKey = req.body.qwenApiKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
  const apiKey = aiProvider === 'qwen' ? qwenApiKey : geminiApiKey;
  const customPrompt = req.body.customPrompt;

  enqueueTranscription(() =>
    processTranscription(id, transcription.filePath!, aiProvider, apiKey, customPrompt, undefined, geminiApiKey)
  );

  console.log(`✅ 转录任务已重新入队，ID: ${id}`);

  return res.json({
    success: true,
    data: updated,
    message: '转录任务已重新提交处理',
  } as ApiResponse);
}

/**
 * 获取诊断信息
 */
export async function getDiagnostics(req: Request, res: Response) {
  const userId = req.userId!;

  // 检查数据库连接
  let dbConnected = false;
  let dbError = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch (error: any) {
    dbConnected = false;
    dbError = error.message;
  }

  // 获取数据统计
  const stats = await prisma.transcription.groupBy({
    by: ['type', 'status'],
    where: { userId },
    _count: true,
  });

  // 统计各类型数量
  const totalCount = await prisma.transcription.count({ where: { userId } });
  const noteCount = await prisma.transcription.count({
    where: { userId, type: 'note' }
  });
  const transcriptionCount = await prisma.transcription.count({
    where: { userId, type: 'transcription' }
  });
  const mergeCount = await prisma.transcription.count({
    where: { userId, type: 'merge' }
  });

  // 获取最新的几条记录（用于验证数据同步）
  const recentNotes = await prisma.transcription.findMany({
    where: { userId, type: 'note' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      fileName: true,
      createdAt: true,
    },
  });

  // 获取数据库连接信息（隐藏敏感信息）
  const dbUrl = process.env.DATABASE_URL || '';
  const dbInfo = dbUrl ? {
    host: dbUrl.match(/@([^:]+)/)?.[1] || 'unknown',
    database: dbUrl.match(/\/\/(?:[^@]+@)?[^:]+:\d+\/([^?]+)/)?.[1] || 'unknown',
    provider: 'postgresql',
  } : null;

  return res.json({
    success: true,
    data: {
      database: {
        connected: dbConnected,
        error: dbError,
        info: dbInfo,
      },
      user: {
        id: userId,
      },
      statistics: {
        total: totalCount,
        notes: noteCount,
        transcriptions: transcriptionCount,
        merges: mergeCount,
        byTypeAndStatus: stats,
      },
      recentNotes: recentNotes,
      timestamp: new Date().toISOString(),
    },
  } as ApiResponse);
}
