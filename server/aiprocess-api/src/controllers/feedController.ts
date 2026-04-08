import { Request, Response } from 'express';
import prisma from '../utils/db';

/**
 * GET /api/feed — 列出信息流
 * Query params: type, category, isRead, isStarred, page, pageSize
 */
export async function list(req: Request, res: Response) {
  const userId = req.userId!;
  const { type, category, isRead, isStarred, page = '1', pageSize = '50' } = req.query as Record<string, string>;

  const where: any = { userId };
  if (type) where.type = type;
  if (category) where.category = category;
  if (isRead !== undefined) where.isRead = isRead === 'true';
  if (isStarred !== undefined) where.isStarred = isStarred === 'true';

  const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(pageSize);
  const take = Math.min(200, parseInt(pageSize));

  const [items, total] = await Promise.all([
    prisma.feedItem.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip,
      take,
    }),
    prisma.feedItem.count({ where }),
  ]);

  // Parse tags JSON
  const parsed = items.map((item) => ({
    ...item,
    tags: (() => { try { return JSON.parse(item.tags); } catch { return []; } })(),
  }));

  return res.json({ success: true, data: parsed, total, page: parseInt(page), pageSize: take });
}

/**
 * POST /api/feed — 创建信息流条目（供 OpenClaw cron 调用）
 */
export async function create(req: Request, res: Response) {
  const userId = req.userId!;
  const { type, category, title, content, source, tags, publishedAt } = req.body;

  if (!type || !title || !content) {
    return res.status(400).json({ success: false, error: '缺少必填字段: type, title, content' });
  }

  const item = await prisma.feedItem.create({
    data: {
      userId,
      type,
      category: category || '',
      title,
      content,
      source: source || '',
      tags: tags ? JSON.stringify(tags) : '[]',
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      pushedAt: new Date(),
    },
  });

  return res.status(201).json({ success: true, data: item });
}

/**
 * PATCH /api/feed/:id — 更新（已读/标星）
 */
export async function update(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { isRead, isStarred } = req.body;

  const item = await prisma.feedItem.findUnique({ where: { id } });
  if (!item || item.userId !== userId) {
    return res.status(404).json({ success: false, error: '未找到' });
  }

  const updates: any = {};
  if (isRead !== undefined) updates.isRead = isRead;
  if (isStarred !== undefined) updates.isStarred = isStarred;

  const updated = await prisma.feedItem.update({ where: { id }, data: updates });
  return res.json({ success: true, data: updated });
}

/**
 * DELETE /api/feed/:id
 */
export async function remove(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const item = await prisma.feedItem.findUnique({ where: { id } });
  if (!item || item.userId !== userId) {
    return res.status(404).json({ success: false, error: '未找到' });
  }

  await prisma.feedItem.delete({ where: { id } });
  return res.json({ success: true });
}

/**
 * POST /api/feed/mark-all-read — 全部标记已读
 */
export async function markAllRead(req: Request, res: Response) {
  const userId = req.userId!;
  const { type } = req.body;

  const where: any = { userId, isRead: false };
  if (type) where.type = type;

  const result = await prisma.feedItem.updateMany({ where, data: { isRead: true } });
  return res.json({ success: true, count: result.count });
}
