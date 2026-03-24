import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * 创建分享链接
 */
export async function createShare(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未授权',
    });
  }

  const { title, content, expiresIn, requireAuth, isPublic, allowedUsers, maxAccessUsers } = req.body;

  if (!title || !content) {
    return res.status(400).json({
      success: false,
      error: '标题和内容不能为空',
    });
  }

  // 计算过期时间（如果提供了）
  let expiresAt: Date | undefined;
  if (expiresIn && expiresIn > 0) {
    expiresAt = new Date(Date.now() + expiresIn * 1000);
  }

  // 处理允许访问的用户列表
  let allowedUsersJson: string | null = null;
  if (allowedUsers && Array.isArray(allowedUsers) && allowedUsers.length > 0) {
    allowedUsersJson = JSON.stringify(allowedUsers);
  }

  const sharedContent = await prisma.sharedContent.create({
    data: {
      title,
      content,
      userId,
      expiresAt,
      requireAuth: requireAuth === true,
      isPublic: isPublic !== false, // 默认为 true
      allowedUsers: allowedUsersJson,
      maxAccessUsers: maxAccessUsers && maxAccessUsers > 0 ? maxAccessUsers : null,
    },
  });

  // 生成分享链接 - 从请求中获取前端URL
  const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || process.env.FRONTEND_URL || 'http://localhost:5173';
  // 如果是 referer，需要提取 origin 部分
  const frontendUrl = origin.includes('/api') ? origin.split('/api')[0] : origin.replace(/\/+$/, '');
  const shareUrl = `${frontendUrl}/share/${sharedContent.shareToken}`;

  res.json({
    success: true,
    data: {
      id: sharedContent.id,
      shareToken: sharedContent.shareToken,
      shareUrl,
      expiresAt: sharedContent.expiresAt,
      requireAuth: sharedContent.requireAuth,
      isPublic: sharedContent.isPublic,
      allowedUsers: sharedContent.allowedUsers ? JSON.parse(sharedContent.allowedUsers) : [],
    },
  });
}

/**
 * 记录访问日志
 */
async function logAccess(
  shareToken: string,
  userId: string | null,
  userEmail: string | null,
  userName: string | null,
  ipAddress: string | undefined,
  userAgent: string | undefined
) {
  try {
    await prisma.shareAccessLog.create({
      data: {
        shareToken,
        userId,
        userEmail,
        userName,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });
  } catch (error) {
    console.error('记录访问日志失败:', error);
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 检查访问权限
 */
async function checkAccessPermission(
  sharedContent: any,
  currentUserId: string | null,
  shareToken?: string
): Promise<{ allowed: boolean; reason?: string }> {
  // 检查是否需要登录
  if (sharedContent.requireAuth && !currentUserId) {
    return { allowed: false, reason: '需要登录' };
  }

  // 检查最大访问账号数限制
  if (sharedContent.maxAccessUsers && sharedContent.maxAccessUsers > 0 && currentUserId && shareToken) {
    // 查询已有多少不同的用户访问过（不包括当前用户）
    const uniqueAccessors = await prisma.shareAccessLog.findMany({
      where: {
        shareToken: shareToken,
        userId: { not: null },
      },
      distinct: ['userId'],
      select: { userId: true },
    });

    const existingUserIds = uniqueAccessors.map(a => a.userId).filter(id => id !== null);

    // 如果当前用户不在已访问列表中，且已达到上限
    if (!existingUserIds.includes(currentUserId) && existingUserIds.length >= sharedContent.maxAccessUsers) {
      return { allowed: false, reason: `访问人数已达上限（最多 ${sharedContent.maxAccessUsers} 人）` };
    }
  }

  // 检查是否公开访问
  if (sharedContent.isPublic) {
    return { allowed: true };
  }

  // 限制访问：检查用户是否在允许列表中
  if (!currentUserId) {
    return { allowed: false, reason: '需要登录且获得访问权限' };
  }

  let allowedUsers: string[] = [];
  if (sharedContent.allowedUsers) {
    try {
      allowedUsers = JSON.parse(sharedContent.allowedUsers);
    } catch (e) {
      console.error('解析 allowedUsers 失败:', e);
    }
  }

  if (allowedUsers.length === 0) {
    // 如果列表为空，默认不允许访问（因为 isPublic = false）
    return { allowed: false, reason: '此分享仅限指定用户访问' };
  }

  if (!allowedUsers.includes(currentUserId)) {
    return { allowed: false, reason: '您没有访问权限' };
  }

  return { allowed: true };
}

/**
 * 获取分享内容
 */
export async function getSharedContent(req: Request, res: Response) {
  const { token } = req.params;
  const currentUserId = (req as any).user?.id || null;
  const currentUserEmail = (req as any).user?.email || null;
  const currentUserName = (req as any).user?.name || null;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  if (!token) {
    return res.status(400).json({
      success: false,
      error: '分享链接无效',
    });
  }

  const sharedContent = await prisma.sharedContent.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      title: true,
      content: true,
      viewCount: true,
      expiresAt: true,
      createdAt: true,
      requireAuth: true,
      isPublic: true,
      allowedUsers: true,
      maxAccessUsers: true,
    },
  });

  if (!sharedContent) {
    return res.status(404).json({
      success: false,
      error: '分享内容不存在或已被删除',
    });
  }

  // 检查是否过期
  if (sharedContent.expiresAt && new Date() > sharedContent.expiresAt) {
    return res.status(410).json({
      success: false,
      error: '分享链接已过期',
    });
  }

  // 检查访问权限
  const accessCheck = await checkAccessPermission(sharedContent, currentUserId, token);
  if (!accessCheck.allowed) {
    // 记录访问尝试（即使被拒绝）
    await logAccess(token, currentUserId, currentUserEmail, currentUserName, ipAddress as string, userAgent);

    return res.status(accessCheck.reason === '需要登录' ? 401 : 403).json({
      success: false,
      error: accessCheck.reason || '访问被拒绝',
      requireAuth: sharedContent.requireAuth,
    });
  }

  // 记录访问日志（无论是否成功访问，都记录）
  await logAccess(token, currentUserId, currentUserEmail, currentUserName, ipAddress as string, userAgent);

  // 增加查看次数（只有成功访问才增加）
  await prisma.sharedContent.update({
    where: { shareToken: token },
    data: { viewCount: { increment: 1 } },
  });

  // 检查是否是动态分享
  let shareConfig = null;
  try {
    shareConfig = JSON.parse(sharedContent.content);
    if (shareConfig.type === 'dynamic') {
      return res.json({
        success: true,
        data: {
          ...sharedContent,
          config: shareConfig,
          isDynamic: true,
          requireAuth: sharedContent.requireAuth,
          isPublic: sharedContent.isPublic,
        },
      });
    }
  } catch (e) {
    // 不是 JSON 格式，返回原始内容（这是旧的静态分享）
  }

  // 返回静态分享内容（旧的单一 notes 分享）
  res.json({
    success: true,
    data: {
      ...sharedContent,
      isDynamic: false,
      requireAuth: sharedContent.requireAuth,
      isPublic: sharedContent.isPublic,
    },
  });
}

/**
 * 获取用户的分享列表
 */
export async function getMyShares(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未授权',
    });
  }

  const shares = await prisma.sharedContent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      shareToken: true,
      viewCount: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // 从请求中获取前端URL
  const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || process.env.FRONTEND_URL || 'http://localhost:5173';
  const frontendUrl = origin.includes('/api') ? origin.split('/api')[0] : origin.replace(/\/+$/, '');

  const sharesWithUrl = shares.map(share => ({
    ...share,
    shareUrl: `${frontendUrl}/share/${share.shareToken}`,
  }));

  res.json({
    success: true,
    data: sharesWithUrl,
  });
}

/**
 * 获取动态分享数据
 */
export async function getDynamicShareData(req: Request, res: Response) {
  const { token } = req.params;
  const currentUserId = (req as any).user?.id || null;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: '分享链接无效',
    });
  }

  // 获取分享配置
  const sharedContent = await prisma.sharedContent.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      content: true,
      expiresAt: true,
      userId: true,
      requireAuth: true,
      isPublic: true,
      allowedUsers: true,
      maxAccessUsers: true,
    },
  });

  if (!sharedContent) {
    return res.status(404).json({
      success: false,
      error: '分享内容不存在或已被删除',
    });
  }

  // 检查是否过期
  if (sharedContent.expiresAt && new Date() > sharedContent.expiresAt) {
    return res.status(410).json({
      success: false,
      error: '分享链接已过期',
    });
  }

  // 获取访问者信息（用于记录日志）
  const currentUserEmail = (req as any).user?.email || null;
  const currentUserName = (req as any).user?.name || null;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  // 检查访问权限
  const accessCheck = await checkAccessPermission(sharedContent, currentUserId, token);
  if (!accessCheck.allowed) {
    // 即使访问被拒绝，也记录访问日志
    await logAccess(token, currentUserId, currentUserEmail, currentUserName, ipAddress as string, userAgent);

    return res.status(accessCheck.reason === '需要登录' ? 401 : 403).json({
      success: false,
      error: accessCheck.reason || '访问被拒绝',
      requireAuth: sharedContent.requireAuth,
    });
  }

  // 记录访问日志（成功访问）
  await logAccess(token, currentUserId, currentUserEmail, currentUserName, ipAddress as string, userAgent);

  // 解析配置
  let shareConfig: any;
  try {
    shareConfig = JSON.parse(sharedContent.content);
    if (shareConfig.type !== 'dynamic') {
      return res.status(400).json({
        success: false,
        error: '此分享链接不是动态分享',
      });
    }
  } catch (e) {
    return res.status(400).json({
      success: false,
      error: '分享配置格式错误',
    });
  }

  // 获取用户的所有转录数据（因为分享的是该用户的数据）
  const transcriptions = await prisma.transcription.findMany({
    where: {
      userId: sharedContent.userId,
      status: 'completed',
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      fileName: true,
      summary: true,
      translatedSummary: true,
      transcriptText: true,
      tags: true,
      status: true,
      actualDate: true,
      createdAt: true,
      updatedAt: true,
      participants: true,
      type: true,
      filePath: true,
      eventDate: true,
      organization: true,
      industry: true,
      country: true,
      topic: true,
    },
  });

  // 获取用户自定义行业列表
  const user = await prisma.user.findUnique({
    where: { id: sharedContent.userId },
    select: { customIndustries: true },
  });

  let customIndustries: string[] = [];
  if (user && user.customIndustries) {
    try {
      customIndustries = JSON.parse(user.customIndustries);
    } catch (e) {
      console.error('解析自定义行业失败:', e);
    }
  }

  // 根据配置返回相应的数据
  const result: any = {};

  // 始终返回用户的行业配置（如果 Directory 模块被启用）
  if (shareConfig.modules.directory) {
    result.industries = customIndustries;
  }

  if (shareConfig.modules.notes) {
    // 返回所有笔记的完整内容（字段与 TranscriptionDetailPage 需要的一致）
    result.notes = transcriptions.map(t => ({
      id: t.id,
      fileName: t.fileName,
      summary: t.summary || '',
      translatedSummary: t.translatedSummary || '',
      transcriptText: t.transcriptText || '',
      tags: (() => {
        try {
          return typeof t.tags === 'string' ? JSON.parse(t.tags) : (t.tags || []);
        } catch (e) {
          return [];
        }
      })(),
      status: t.status,
      actualDate: t.actualDate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      participants: t.participants || '',
      type: t.type,
      filePath: t.filePath,
      eventDate: t.eventDate,
      organization: t.organization || '',
      industry: t.industry || '',
      country: t.country || '',
      topic: t.topic || '',
    }));
  }

  if (shareConfig.modules.history) {
    // 返回历史记录列表
    result.history = transcriptions.map(t => ({
      id: t.id,
      fileName: t.fileName,
      tags: (() => {
        try {
          return typeof t.tags === 'string' ? JSON.parse(t.tags) : (t.tags || []);
        } catch (e) {
          return [];
        }
      })(),
      status: t.status,

      actualDate: t.actualDate,
      createdAt: t.createdAt,
      participants: t.participants || '',
      type: t.type,
      eventDate: t.eventDate,
      topic: t.topic || '',
    }));
  }

  if (shareConfig.modules.directory) {
    // 返回组织目录数据
    result.directory = transcriptions.map(t => ({
      id: t.id,
      fileName: t.fileName,
      organization: t.organization || '',
      industry: t.industry || '',
      participants: t.participants || '',
      actualDate: t.actualDate,
      createdAt: t.createdAt,
      eventDate: t.eventDate,
      topic: t.topic || '',
    }));
  }

  res.json({
    success: true,
    data: result,
  });
}

/**
 * 更新分享设置
 */
export async function updateShareSettings(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未授权',
    });
  }

  const { token } = req.params;
  const { requireAuth, isPublic, allowedUsers } = req.body;

  // 验证所有权
  const sharedContent = await prisma.sharedContent.findUnique({
    where: { shareToken: token },
    select: { userId: true },
  });

  if (!sharedContent) {
    return res.status(404).json({
      success: false,
      error: '分享内容不存在',
    });
  }

  if (sharedContent.userId !== userId) {
    return res.status(403).json({
      success: false,
      error: '无权修改此分享',
    });
  }

  // 处理允许访问的用户列表
  let allowedUsersJson: string | null = null;
  if (allowedUsers && Array.isArray(allowedUsers) && allowedUsers.length > 0) {
    allowedUsersJson = JSON.stringify(allowedUsers);
  }

  const updated = await prisma.sharedContent.update({
    where: { shareToken: token },
    data: {
      requireAuth: requireAuth !== undefined ? requireAuth : undefined,
      isPublic: isPublic !== undefined ? isPublic : undefined,
      allowedUsers: allowedUsers !== undefined ? allowedUsersJson : undefined,
    },
    select: {
      requireAuth: true,
      isPublic: true,
      allowedUsers: true,
    },
  });

  res.json({
    success: true,
    data: {
      requireAuth: updated.requireAuth,
      isPublic: updated.isPublic,
      allowedUsers: updated.allowedUsers ? JSON.parse(updated.allowedUsers) : [],
    },
  });
}

/**
 * 获取访问日志
 */
export async function getAccessLogs(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未授权',
    });
  }

  const { token } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 20;
  const filterUserId = req.query.userId as string | undefined;
  const skip = (page - 1) * pageSize;

  // 验证所有权
  const sharedContent = await prisma.sharedContent.findUnique({
    where: { shareToken: token },
    select: { userId: true },
  });

  if (!sharedContent) {
    return res.status(404).json({
      success: false,
      error: '分享内容不存在',
    });
  }

  if (sharedContent.userId !== userId) {
    return res.status(403).json({
      success: false,
      error: '无权查看此分享的访问日志',
    });
  }

  // 构建查询条件
  const where: any = { shareToken: token };
  if (filterUserId) {
    where.userId = filterUserId;
  }

  // 获取访问日志（按用户分组统计）
  const [logs, total] = await Promise.all([
    prisma.shareAccessLog.findMany({
      where,
      orderBy: { accessedAt: 'desc' },
      skip,
      take: pageSize,
      select: {
        id: true,
        userId: true,
        userEmail: true,
        userName: true,
        ipAddress: true,
        userAgent: true,
        accessedAt: true,
      },
    }),
    prisma.shareAccessLog.count({ where }),
  ]);

  // 获取每个用户的访问次数
  const userAccessCounts = await prisma.shareAccessLog.groupBy({
    by: ['userId'],
    where: { shareToken: token },
    _count: { userId: true },
  });

  const accessCountMap = new Map<string, number>();
  userAccessCounts.forEach(item => {
    if (item.userId) {
      accessCountMap.set(item.userId, item._count.userId);
    }
  });

  // 添加访问次数到日志
  const logsWithCount = logs.map(log => ({
    ...log,
    accessCount: log.userId ? (accessCountMap.get(log.userId) || 1) : 1,
  }));

  // 获取独立访问者数量
  const uniqueUsers = await prisma.shareAccessLog.groupBy({
    by: ['userId'],
    where: { shareToken: token },
  });

  res.json({
    success: true,
    data: {
      items: logsWithCount,
      total,
      page,
      pageSize,
      uniqueVisitors: uniqueUsers.length,
    },
  });
}

/**
 * 撤销访问权限
 */
export async function revokeAccess(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未授权',
    });
  }

  const { token } = req.params;
  const { targetUserId } = req.body;

  if (!targetUserId) {
    return res.status(400).json({
      success: false,
      error: '请指定要撤销的用户ID',
    });
  }

  // 验证所有权
  const sharedContent = await prisma.sharedContent.findUnique({
    where: { shareToken: token },
    select: { userId: true, allowedUsers: true },
  });

  if (!sharedContent) {
    return res.status(404).json({
      success: false,
      error: '分享内容不存在',
    });
  }

  if (sharedContent.userId !== userId) {
    return res.status(403).json({
      success: false,
      error: '无权修改此分享',
    });
  }

  // 从允许列表中移除用户
  let allowedUsers: string[] = [];
  if (sharedContent.allowedUsers) {
    try {
      allowedUsers = JSON.parse(sharedContent.allowedUsers);
    } catch (e) {
      console.error('解析 allowedUsers 失败:', e);
    }
  }

  const updatedAllowedUsers = allowedUsers.filter(id => id !== targetUserId);

  await prisma.sharedContent.update({
    where: { shareToken: token },
    data: {
      allowedUsers: updatedAllowedUsers.length > 0 ? JSON.stringify(updatedAllowedUsers) : null,
    },
  });

  res.json({
    success: true,
    message: '访问权限已撤销',
    data: {
      allowedUsers: updatedAllowedUsers,
    },
  });
}

/**
 * 删除分享
 */
export async function deleteShare(req: Request, res: Response) {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未授权',
    });
  }

  const { id } = req.params;

  // 验证所有权
  const sharedContent = await prisma.sharedContent.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!sharedContent) {
    return res.status(404).json({
      success: false,
      error: '分享内容不存在',
    });
  }

  if (sharedContent.userId !== userId) {
    return res.status(403).json({
      success: false,
      error: '无权删除此分享',
    });
  }

  await prisma.sharedContent.delete({
    where: { id },
  });

  res.json({
    success: true,
    message: '分享已删除',
  });
}


