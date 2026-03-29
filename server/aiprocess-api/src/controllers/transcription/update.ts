import { Request, Response } from 'express';
import prisma from '../../utils/db';
import type { ApiResponse, TranscriptionUpdateSummaryRequest } from '../../types';

export async function updateTranscriptionSummary(req: Request, res: Response) {
  console.log('📝 更新转录总结请求:', {
    method: req.method,
    path: req.path,
    params: req.params,
    userId: req.userId,
  });
  const userId = req.userId!;
  const { id } = req.params;
  const { summary, version } = req.body as TranscriptionUpdateSummaryRequest;

  if (!summary) {
    return res.status(400).json({
      success: false,
      error: '请提供总结内容',
    } as ApiResponse);
  }

  // 验证记录存在且属于当前用户
  const existing = await prisma.transcription.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 乐观锁：如果提供了版本号，检查版本是否匹配
  if (version !== undefined && existing.version !== version) {
    console.warn(`⚠️ 版本冲突: 记录 ${id} 的版本 ${existing.version} 与请求的版本 ${version} 不匹配`);
    return res.status(409).json({
      success: false,
      error: 'CONFLICT',
      message: '数据已被其他会话修改，请刷新页面后重试',
      data: {
        currentVersion: existing.version,
        requestedVersion: version,
      },
    } as ApiResponse);
  }

  // 更新记录，同时递增版本号
  const transcription = await prisma.transcription.update({
    where: { id },
    data: {
      summary,
      version: { increment: 1 }, // 递增版本号
    },
  });

  // 解析 tags 字段
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(transcription.tags || '[]');
  } catch {
    parsedTags = [];
  }

  // 解析 mergeSources 字段
  let parsedMergeSources: Array<{ id: string; title: string; content: string }> = [];
  if ((transcription as any).type === 'merge' && (transcription as any).mergeSources) {
    try {
      parsedMergeSources = JSON.parse((transcription as any).mergeSources);
    } catch {
      parsedMergeSources = [];
    }
  }

  return res.json({
    success: true,
    data: {
      ...transcription,
      tags: parsedTags,
      mergeSources: parsedMergeSources,
    },
    message: '总结更新成功',
  } as ApiResponse);
}

/**
 * 更新转录中文总结
 */
export async function updateTranscriptionTranslatedSummary(req: Request, res: Response) {
  console.log('📝 更新转录中文总结请求:', {
    method: req.method,
    path: req.path,
    params: req.params,
    userId: req.userId,
  });
  const userId = req.userId!;
  const { id } = req.params;
  const { translatedSummary, version } = req.body as { translatedSummary: string; version?: number };

  // 验证记录存在且属于当前用户
  const existing = await prisma.transcription.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 乐观锁：如果提供了版本号，检查版本是否匹配
  if (version !== undefined && existing.version !== version) {
    console.warn(`⚠️ 版本冲突: 记录 ${id} 的版本 ${existing.version} 与请求的版本 ${version} 不匹配`);
    return res.status(409).json({
      success: false,
      error: 'CONFLICT',
      message: '数据已被其他会话修改，请刷新页面后重试',
      data: {
        currentVersion: existing.version,
        requestedVersion: version,
      },
    } as ApiResponse);
  }

  // 更新记录，同时递增版本号
  const transcription = await prisma.transcription.update({
    where: { id },
    data: {
      translatedSummary: translatedSummary || '',
      version: { increment: 1 }, // 递增版本号
    },
  });

  // 解析 tags 字段
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(transcription.tags || '[]');
  } catch {
    parsedTags = [];
  }

  // 解析 mergeSources 字段
  let parsedMergeSources: Array<{ id: string; title: string; content: string }> = [];
  if ((transcription as any).type === 'merge' && (transcription as any).mergeSources) {
    try {
      parsedMergeSources = JSON.parse((transcription as any).mergeSources);
    } catch {
      parsedMergeSources = [];
    }
  }

  return res.json({
    success: true,
    data: {
      ...transcription,
      tags: parsedTags,
      mergeSources: parsedMergeSources,
    },
    message: '中文总结更新成功',
  } as ApiResponse);
}

/**
 * 更新转录文件名
 */
export async function updateTranscriptionFileName(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { fileName } = req.body;

  if (!fileName || !fileName.trim()) {
    return res.status(400).json({
      success: false,
      error: '文件名不能为空',
    } as ApiResponse);
  }

  // 验证记录存在且属于当前用户
  const existing = await prisma.transcription.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  const transcription = await prisma.transcription.update({
    where: { id },
    data: { fileName: fileName.trim() },
  });

  // 解析 tags 字段
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(transcription.tags || '[]');
  } catch {
    parsedTags = [];
  }

  return res.json({
    success: true,
    data: {
      ...transcription,
      tags: parsedTags,
    },
    message: '文件名更新成功',
  } as ApiResponse);
}

/**
 * 更新转录标签
 */
export async function updateTranscriptionTags(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { tags } = req.body;

  if (!Array.isArray(tags)) {
    return res.status(400).json({
      success: false,
      error: '标签必须是数组格式',
    } as ApiResponse);
  }

  if (tags.length > 5) {
    return res.status(400).json({
      success: false,
      error: '最多只能添加5个标签',
    } as ApiResponse);
  }

  // 验证记录存在且属于当前用户
  const existing = await prisma.transcription.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 验证标签格式（非空字符串）
  const validTags = tags.filter((tag: any) => typeof tag === 'string' && tag.trim().length > 0);
  const uniqueTags = Array.from(new Set(validTags)).slice(0, 5); // 去重并限制最多5个

  const transcription = await prisma.transcription.update({
    where: { id },
    data: { tags: JSON.stringify(uniqueTags) } as any,
  });

  // 解析 tags 返回给前端
  const parsedTranscription = {
    ...transcription,
    tags: uniqueTags,
  };

  return res.json({
    success: true,
    data: parsedTranscription as any,
    message: '标签更新成功',
  } as ApiResponse);
}

/**
 * 更新转录实际发生日期
 */
export async function updateTranscriptionActualDate(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { actualDate } = req.body as { actualDate?: string | null };

  // 验证记录存在且属于当前用户
  const existing = await prisma.transcription.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 如果 actualDate 为空字符串或 null，则设置为 null
  let actualDateValue: Date | null = null;
  if (actualDate && actualDate.trim()) {
    const parsedDate = new Date(actualDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: '日期格式无效',
      } as ApiResponse);
    }
    actualDateValue = parsedDate;
  }

  const transcription = await prisma.transcription.update({
    where: { id },
    data: { actualDate: actualDateValue } as any,
  });

  // 解析 tags 字段
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(transcription.tags || '[]');
  } catch {
    parsedTags = [];
  }

  return res.json({
    success: true,
    data: {
      ...transcription,
      tags: parsedTags,
    },
    message: '实际发生日期更新成功',
  } as ApiResponse);
}

/**
 * 更新转录所属项目
 */
export async function updateTranscriptionProject(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { projectId } = req.body as { projectId?: string | null };

  // 验证记录存在且属于当前用户
  const existing = await prisma.transcription.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 如果 projectId 为空字符串或 null，则设置为 null
  let projectIdValue: string | null = null;
  if (projectId && projectId.trim()) {
    // 验证项目是否存在且属于当前用户
    const project = await (prisma as any).project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      return res.status(404).json({
        success: false,
        error: '项目不存在',
      } as ApiResponse);
    }
    projectIdValue = projectId;
  }

  const transcription = await (prisma.transcription.update as any)({
    where: { id },
    data: { projectId: projectIdValue },
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // 解析 tags 字段
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(transcription.tags || '[]');
  } catch {
    parsedTags = [];
  }

  return res.json({
    success: true,
    data: {
      ...transcription,
      tags: parsedTags,
    },
    message: '项目归类更新成功',
  } as ApiResponse);
}

/**
 * 更新转录元数据（主题、机构、参与人、发生时间）
 */
export async function updateTranscriptionMetadata(req: Request, res: Response) {
  console.log('📝 更新转录元数据请求:', {
    method: req.method,
    path: req.path,
    url: req.url,
    params: req.params,
    userId: req.userId,
    body: req.body,
  });
  const userId = req.userId!;
  const { id } = req.params;
  const { topic, organization, intermediary, industry, country, participants, eventDate, speaker } = req.body as {
    topic?: string;
    organization?: string;
    intermediary?: string;
    industry?: string;
    country?: string;
    participants?: string;
    eventDate?: string;
    speaker?: string;
  };

  // 验证记录存在且属于当前用户
  const existing = await prisma.transcription.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 构建更新数据
  const updateData: any = {};
  if (topic !== undefined) updateData.topic = topic;
  if (organization !== undefined) updateData.organization = organization;
  if (intermediary !== undefined) updateData.intermediary = intermediary;
  if (industry !== undefined) updateData.industry = industry;
  if (country !== undefined) updateData.country = country;
  if (participants !== undefined) updateData.participants = participants;
  if (eventDate !== undefined) updateData.eventDate = eventDate;
  if (speaker !== undefined) updateData.speaker = speaker;

  // 同时更新 fileName 以保持一致
  const newTopic = topic !== undefined ? topic : existing.topic || '未知主题';
  const newOrg = organization !== undefined ? organization : existing.organization || '未知';
  const newIntermediary = intermediary !== undefined ? intermediary : existing.intermediary || '';
  const newParticipants = participants !== undefined ? participants : existing.participants || '未知';
  const newCountry = country !== undefined ? country : existing.country || '未知';
  let newEventDate = eventDate !== undefined ? eventDate : existing.eventDate || '未提及';

  // 如果 eventDate 是"未提及"，则使用创建时间
  if (newEventDate === '未提及') {
    newEventDate = new Date(existing.createdAt).toLocaleDateString('zh-CN');
  }

  // 构建文件名，中介为"未知"时不显示
  const parts = [newTopic, newOrg];
  if (newIntermediary && newIntermediary !== '未知') {
    parts.push(newIntermediary);
  }
  parts.push(newParticipants, newCountry, newEventDate);
  updateData.fileName = parts.join('-');

  const transcription = await (prisma.transcription.update as any)({
    where: { id },
    data: updateData,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // 解析 tags 字段
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(transcription.tags || '[]');
  } catch {
    parsedTags = [];
  }

  return res.json({
    success: true,
    data: {
      ...transcription,
      tags: parsedTags,
    },
    message: '元数据更新成功',
  } as ApiResponse);
}
