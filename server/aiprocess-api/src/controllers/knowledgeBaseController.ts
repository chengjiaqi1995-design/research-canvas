import { Request, Response } from 'express';
import * as vertexAIService from '../services/vertexAIService';
import * as notebooklmService from '../services/notebooklmService';
import prisma from '../utils/db';

export async function getKnowledgeBaseStatus(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ configured: false, message: '未授权' });
  }

  const status = await vertexAIService.checkVertexAIStatus();

  // 获取最后一次同步时间
  const lastSyncedTranscription = await prisma.transcription.findFirst({
    where: {
      userId,
      lastSyncedAt: { not: null },
    },
    orderBy: { lastSyncedAt: 'desc' },
    select: { lastSyncedAt: true },
  });

  // 获取同步统计
  const totalCount = await prisma.transcription.count({
    where: { userId, status: 'completed' },
  });

  const syncedCount = await prisma.transcription.count({
    where: {
      userId,
      status: 'completed',
      lastSyncedAt: { not: null },
    },
  });

  res.json({
    ...status,
    lastSyncedAt: lastSyncedTranscription?.lastSyncedAt?.toISOString() || null,
    totalNotes: totalCount,
    syncedNotes: syncedCount,
  });
}

export async function getIndexProgress(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: '未授权' });
  }

  // 获取索引进度
  const progress = await vertexAIService.getIndexProgress();

  res.json({
    success: true,
    ...progress,
  });
}

export async function searchKnowledgeBase(req: Request, res: Response) {
  const { query, pageSize = 10, pageToken, filters } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({
      error: '无效的查询参数',
      message: '查询字符串不能为空',
    });
  }

  const results = await vertexAIService.searchDocuments(query, pageSize, pageToken, filters);

  console.log(`🔍 搜索"${query}"完成:`, {
    找到文档数: results.results?.length || 0,
    索引总文档数: results.totalSize || 0,
  });

  res.json({
    success: true,
    query,
    results: results.results,
    nextPageToken: results.nextPageToken,
    totalSize: results.totalSize,
  });
}

export async function queryNotebookLm(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, error: '未授权' });
  }

  const { question } = req.body;
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: '无效的查询参数',
      message: '问题不能为空',
    });
  }

  const maxSources = Number(process.env.NOTEBOOKLM_MAX_SOURCES || 80);
  const maxChars = Number(process.env.NOTEBOOKLM_MAX_CHARS || 200000);
  const maxPerSource = Number(process.env.NOTEBOOKLM_MAX_SOURCE_CHARS || 8000);

  const notes = await prisma.transcription.findMany({
    where: { userId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      topic: true,
      summary: true,
      translatedSummary: true,
      transcriptText: true,
      organization: true,
      industry: true,
      country: true,
      participants: true,
      eventDate: true,
      createdAt: true,
    },
  });

  const sources: notebooklmService.NotebookLmSource[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const note of notes) {
    if (sources.length >= maxSources) {
      truncated = true;
      break;
    }

    const title = note.fileName || note.topic || '未命名';
    const contentParts = [
      `标题: ${title}`,
      note.summary ? `摘要: ${note.summary}` : '',
      note.translatedSummary ? `中文摘要: ${note.translatedSummary}` : '',
      note.transcriptText ? `全文: ${note.transcriptText}` : '',
    ].filter(Boolean);

    const content = contentParts.join('\n');
    if (!content.trim()) {
      continue;
    }

    const remaining = maxChars - totalChars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const clippedContent = content.slice(0, Math.min(maxPerSource, remaining));
    totalChars += clippedContent.length;

    sources.push({
      id: note.id,
      title,
      content: clippedContent,
      metadata: {
        organization: note.organization,
        industry: note.industry,
        country: note.country,
        participants: note.participants,
        eventDate: note.eventDate,
        createdAt: note.createdAt,
      },
    });
  }

  const result = await notebooklmService.queryNotebookLm({
    question: question.trim(),
    sources,
    userId,
  });

  res.json({
    success: true,
    answer: result.answer || '',
    citations: result.citations || [],
    sourcesIncluded: sources.length,
    sourcesTotal: notes.length,
    truncated,
  });
}
export async function syncAllTranscriptions(req: Request, res: Response) {
  const transcriptions = await prisma.transcription.findMany({
    where: {
      status: 'completed',
    },
    select: {
      id: true,
      fileName: true,
      summary: true,
      transcriptText: true,
      topic: true,
      organization: true,
      participants: true,
      eventDate: true,
      tags: true,
      createdAt: true,
    },
  });

  if (transcriptions.length === 0) {
    return res.json({
      success: true,
      message: '没有需要同步的转录记录',
      synced: 0,
      failed: 0,
    });
  }

  const documents = transcriptions.map((t) => {
    let transcriptContent = '';
    try {
      const parsedTranscript = JSON.parse(t.transcriptText || '[]');
      if (Array.isArray(parsedTranscript)) {
        transcriptContent = parsedTranscript.map((item: any) => item.text || '').join('\n');
      }
    } catch {
      transcriptContent = t.transcriptText || '';
    }

    let tags: string[] = [];
    try {
      tags = JSON.parse(t.tags || '[]');
    } catch {
      tags = [];
    }

    const content = `
标题: ${t.fileName}
主题: ${t.topic || '未知'}
机构: ${t.organization || '未知'}
参与人: ${t.participants || '未知'}
时间: ${t.eventDate || '未提及'}
标签: ${tags.join(', ')}

摘要:
${t.summary || ''}

转录内容:
${transcriptContent}
      `.trim();

    return {
      id: t.id,
      content,
      metadata: {
        fileName: t.fileName,
        topic: t.topic,
        organization: t.organization,
        participants: t.participants,
        eventDate: t.eventDate,
        tags: tags,
        createdAt: t.createdAt.toISOString(),
      },
    };
  });

  const results = await vertexAIService.batchIndexDocuments(documents);

  // 更新成功同步的记录的 lastSyncedAt
  if (results.success > 0 && results.successIds && results.successIds.length > 0) {
    await prisma.transcription.updateMany({
      where: { id: { in: results.successIds } },
      data: { lastSyncedAt: new Date() },
    });
  }

  res.json({
    success: true,
    message: `同步完成: 成功 ${results.success}, 失败 ${results.failed}`,
    synced: results.success,
    failed: results.failed,
    errors: results.errors,
  });
}

export async function indexTranscription(req: Request, res: Response) {
  const { id } = req.params;

  const transcription = await prisma.transcription.findFirst({
    where: {
      id,
      status: 'completed',
    },
  });

  if (!transcription) {
    return res.status(404).json({
      error: '转录记录不存在或未完成',
    });
  }

  let transcriptContent = '';
  try {
    const parsedTranscript = JSON.parse(transcription.transcriptText || '[]');
    if (Array.isArray(parsedTranscript)) {
      transcriptContent = parsedTranscript.map((item: any) => item.text || '').join('\n');
    }
  } catch {
    transcriptContent = transcription.transcriptText || '';
  }

  let tags: string[] = [];
  try {
    tags = JSON.parse(transcription.tags || '[]');
  } catch {
    tags = [];
  }

  const content = `
标题: ${transcription.fileName}
主题: ${transcription.topic || '未知'}
机构: ${transcription.organization || '未知'}
参与人: ${transcription.participants || '未知'}
时间: ${transcription.eventDate || '未提及'}
标签: ${tags.join(', ')}

摘要:
${transcription.summary || ''}

转录内容:
${transcriptContent}
    `.trim();

  await vertexAIService.indexDocument(
    transcription.id,
    content,
    {
      fileName: transcription.fileName,
      topic: transcription.topic,
      organization: transcription.organization,
      participants: transcription.participants,
      eventDate: transcription.eventDate,
      tags: tags,
      createdAt: transcription.createdAt.toISOString(),
    }
  );

  // 更新同步时间
  await prisma.transcription.update({
    where: { id },
    data: { lastSyncedAt: new Date() },
  });

  res.json({
    success: true,
    message: `转录记录 ${transcription.fileName} 索引成功`,
  });
}

export async function deleteIndex(req: Request, res: Response) {
  const { id } = req.params;

  const transcription = await prisma.transcription.findFirst({
    where: {
      id,
    },
  });

  if (!transcription) {
    return res.status(404).json({
      error: '转录记录不存在',
    });
  }

  await vertexAIService.deleteDocument(id);

  res.json({
    success: true,
    message: `转录记录 ${transcription.fileName} 的索引已删除`,
  });
}
