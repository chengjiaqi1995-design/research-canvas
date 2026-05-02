import { Request, Response } from 'express';
import prisma from '../utils/db';

let feedSchemaReady: Promise<void> | null = null;

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String).filter(Boolean);
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeFormat(format: unknown): string {
  const value = typeof format === 'string' ? format.toLowerCase() : '';
  return ['markdown', 'html', 'text'].includes(value) ? value : 'markdown';
}

function normalizeReportType(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'custom_report';
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'custom_report';
}

function inferReportType(input: {
  title?: string;
  category?: string;
  reportKey?: string;
  originalName?: string;
  reportType?: string;
  reportTypeLabel?: string;
}): { reportType: string; reportTypeLabel: string } {
  if (input.reportType || input.reportTypeLabel) {
    const label = (input.reportTypeLabel || input.reportType || '').trim();
    return {
      reportType: normalizeReportType(input.reportType || label),
      reportTypeLabel: label || '交互报告',
    };
  }

  const haystack = [input.title, input.category, input.reportKey, input.originalName].filter(Boolean).join(' ').toLowerCase();
  if (/投资者|持仓|investor|holding|position/.test(haystack)) {
    return { reportType: 'investor_holdings', reportTypeLabel: '投资者持仓' };
  }

  return { reportType: 'custom_report', reportTypeLabel: input.category || '交互报告' };
}

function normalizeHtmlReport(html: string): string {
  let normalized = html || '';
  // A literal "</script>" inside inline JavaScript strings prematurely closes
  // the script tag in browsers and causes the remaining JS bundle to render as text.
  normalized = normalized.replace(/<\/script>(?!\s*(?:<|$))/gi, '<\\/script>');
  normalized = normalized.replace(/<\/script>(?=\s*["'`])/gi, '<\\/script>');

  if (!/<meta\s+charset=/i.test(normalized)) {
    normalized = normalized.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
  }
  return normalized;
}

async function ensureFeedSchema() {
  if (!feedSchemaReady) {
    feedSchemaReady = (async () => {
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "contentFormat" TEXT NOT NULL DEFAULT \'markdown\'');
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "reportKey" TEXT NOT NULL DEFAULT \'\'');
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "reportVersion" TEXT NOT NULL DEFAULT \'\'');
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "reportType" TEXT NOT NULL DEFAULT \'\'');
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "reportTypeLabel" TEXT NOT NULL DEFAULT \'\'');
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "originalName" TEXT NOT NULL DEFAULT \'\'');
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "htmlUrl" TEXT NOT NULL DEFAULT \'\'');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "FeedItem_userId_reportKey_idx" ON "FeedItem" ("userId", "reportKey")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "FeedItem_userId_reportType_idx" ON "FeedItem" ("userId", "reportType")');
    })().catch((err) => {
      feedSchemaReady = null;
      throw err;
    });
  }
  return feedSchemaReady;
}

/**
 * GET /api/feed — 列出信息流
 * Query params: type, category, isRead, isStarred, page, pageSize
 */
export async function list(req: Request, res: Response) {
  await ensureFeedSchema();
  const userId = req.userId!;
  const { type, category, isRead, isStarred, reportKey, reportType, page = '1', pageSize = '50' } = req.query as Record<string, string>;

  const where: any = { userId };
  if (type) where.type = type;
  if (category) where.category = category;
  if (reportKey) where.reportKey = reportKey;
  if (reportType) where.reportType = reportType;
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
    ...(() => {
      const anyItem = item as typeof item & { reportType?: string; reportTypeLabel?: string };
      if (item.type !== 'report' && item.contentFormat !== 'html' && !item.htmlUrl) return {};
      if (anyItem.reportType && anyItem.reportTypeLabel) return {};
      return inferReportType({
        title: item.title,
        category: item.category,
        reportKey: item.reportKey,
        originalName: item.originalName,
        reportType: anyItem.reportType,
        reportTypeLabel: anyItem.reportTypeLabel,
      });
    })(),
    tags: (() => { try { return JSON.parse(item.tags); } catch { return []; } })(),
  }));

  return res.json({ success: true, data: parsed, total, page: parseInt(page), pageSize: take });
}

/**
 * POST /api/feed — 创建信息流条目（供 OpenClaw cron 调用）
 */
export async function create(req: Request, res: Response) {
  await ensureFeedSchema();
  const userId = req.userId!;
  const {
    type,
    category,
    title,
    content,
    source,
    tags,
    publishedAt,
    contentFormat,
    reportKey,
    reportVersion,
    reportType,
    reportTypeLabel,
    originalName,
    htmlUrl,
    mode,
  } = req.body;

  if (!type || !title || !content) {
    return res.status(400).json({ success: false, error: '缺少必填字段: type, title, content' });
  }

  const reportMeta = normalizeFormat(contentFormat) === 'html'
    ? inferReportType({ title, category, reportKey, originalName, reportType, reportTypeLabel })
    : { reportType: reportType || '', reportTypeLabel: reportTypeLabel || '' };

  const data = {
    userId,
    type,
    category: category || '',
    title,
    content: normalizeFormat(contentFormat) === 'html' ? normalizeHtmlReport(content) : content,
    contentFormat: normalizeFormat(contentFormat),
    source: source || '',
    tags: JSON.stringify(parseTags(tags)),
    reportKey: reportKey || '',
    reportVersion: reportVersion || '',
    reportType: reportMeta.reportType,
    reportTypeLabel: reportMeta.reportTypeLabel,
    originalName: originalName || '',
    htmlUrl: htmlUrl || '',
    publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
    pushedAt: new Date(),
  };

  if (mode === 'upsert' && data.reportKey) {
    const existing = await prisma.feedItem.findFirst({
      where: { userId, reportKey: data.reportKey },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      const item = await prisma.feedItem.update({
        where: { id: existing.id },
        data: {
          ...data,
          isRead: false,
        },
      });
      return res.json({ success: true, data: { ...item, tags: parseTags(item.tags) }, upserted: true });
    }
  }

  const item = await prisma.feedItem.create({ data });

  return res.status(201).json({ success: true, data: { ...item, tags: parseTags(item.tags) } });
}

/**
 * POST /api/feed/html-report — 创建或更新 HTML 报告信息流条目
 */
export async function createHtmlReport(req: Request, res: Response) {
  await ensureFeedSchema();
  const {
    title,
    html,
    summary,
    category,
    source,
    tags,
    reportKey,
    reportVersion,
    reportType,
    reportTypeLabel,
    originalName,
    htmlUrl,
    mode = 'create',
    preserveHistory = true,
    publishedAt,
  } = req.body;

  if (!title || !html) {
    return res.status(400).json({ success: false, error: '缺少必填字段: title, html' });
  }

  req.body = {
    type: 'report',
    title,
    content: normalizeHtmlReport(html),
    contentFormat: 'html',
    category: category || '',
    source: source || '',
    tags,
    reportKey: reportKey || title,
    reportVersion: reportVersion || new Date().toISOString(),
    reportType,
    reportTypeLabel,
    originalName: originalName || '',
    htmlUrl: htmlUrl || '',
    mode: preserveHistory === false ? mode : 'create',
    publishedAt,
    summary,
  };

  return create(req, res);
}

/**
 * PATCH /api/feed/:id — 更新（已读/标星/报告字段）
 */
export async function update(req: Request, res: Response) {
  await ensureFeedSchema();
  const userId = req.userId!;
  const { id } = req.params;
  const {
    isRead,
    isStarred,
    title,
    content,
    category,
    source,
    tags,
    contentFormat,
    reportKey,
    reportVersion,
    reportType,
    reportTypeLabel,
    originalName,
    htmlUrl,
  } = req.body;

  const item = await prisma.feedItem.findUnique({ where: { id } });
  if (!item || item.userId !== userId) {
    return res.status(404).json({ success: false, error: '未找到' });
  }

  const updates: any = {};
  if (isRead !== undefined) updates.isRead = isRead;
  if (isStarred !== undefined) updates.isStarred = isStarred;
  if (title !== undefined) updates.title = title;
  if (content !== undefined) {
    const nextFormat = contentFormat !== undefined ? normalizeFormat(contentFormat) : item.contentFormat;
    updates.content = nextFormat === 'html' ? normalizeHtmlReport(content) : content;
  }
  if (category !== undefined) updates.category = category;
  if (source !== undefined) updates.source = source;
  if (tags !== undefined) updates.tags = JSON.stringify(parseTags(tags));
  if (contentFormat !== undefined) updates.contentFormat = normalizeFormat(contentFormat);
  if (reportKey !== undefined) updates.reportKey = reportKey;
  if (reportVersion !== undefined) updates.reportVersion = reportVersion;
  if (reportType !== undefined || reportTypeLabel !== undefined) {
    const existingReport = item as typeof item & { reportType?: string; reportTypeLabel?: string };
    const nextReportMeta = inferReportType({
      title: title ?? item.title,
      category: category ?? item.category,
      reportKey: reportKey ?? item.reportKey,
      originalName: originalName ?? item.originalName,
      reportType: reportType ?? existingReport.reportType,
      reportTypeLabel: reportTypeLabel ?? existingReport.reportTypeLabel,
    });
    updates.reportType = nextReportMeta.reportType;
    updates.reportTypeLabel = nextReportMeta.reportTypeLabel;
  }
  if (originalName !== undefined) updates.originalName = originalName;
  if (htmlUrl !== undefined) updates.htmlUrl = htmlUrl;

  const updated = await prisma.feedItem.update({ where: { id }, data: updates });
  return res.json({ success: true, data: { ...updated, tags: parseTags(updated.tags) } });
}

/**
 * DELETE /api/feed/:id
 */
export async function remove(req: Request, res: Response) {
  await ensureFeedSchema();
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
  await ensureFeedSchema();
  const userId = req.userId!;
  const { type } = req.body;

  const where: any = { userId, isRead: false };
  if (type) where.type = type;

  const result = await prisma.feedItem.updateMany({ where, data: { isRead: true } });
  return res.json({ success: true, count: result.count });
}
