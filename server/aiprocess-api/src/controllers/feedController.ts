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

function normalizeFeedType(value: unknown, fallback = 'news'): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const allowed = new Set(['news', 'industry', 'podcast', 'weekly', 'macro', 'report']);
  return allowed.has(raw) ? raw : fallback;
}

const SUMMARY_REPORT_LABEL = '总结报告';
const SUMMARY_REPORT_CATEGORIES = ['总结报告', '周报', '日报', '月报', '季报', '年报', 'weekly', 'daily', 'monthly', 'quarterly', 'annual', 'summary', 'recap'];

function isSummaryReportText(...values: unknown[]): boolean {
  return /周报|日报|月报|季报|年报|总结报告|weekly|daily|monthly|quarterly|annual|summary|recap/i.test(values.filter(Boolean).map(String).join(' '));
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
  if (isSummaryReportText(input.reportType, input.reportTypeLabel, input.title, input.category, input.reportKey, input.originalName)) {
    return { reportType: 'summary_report', reportTypeLabel: SUMMARY_REPORT_LABEL };
  }

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

function isHtmlReportLike(item: { type?: string; contentFormat?: string; htmlUrl?: string }) {
  return item.type === 'report' || item.contentFormat === 'html' || Boolean(item.htmlUrl);
}

function normalizeCategoryLabelForFeed(item: {
  type?: string;
  title?: string;
  category?: string;
  reportType?: string;
  reportTypeLabel?: string;
}) {
  const raw = (item.category || '').trim();
  if (!raw) return '';
  return isSummaryReportText(raw, item.type, item.reportType, item.reportTypeLabel, item.title)
    ? SUMMARY_REPORT_LABEL
    : raw;
}

function buildFeedMeta(items: Array<{
  type: string;
  category: string;
  title: string;
  contentFormat: string;
  htmlUrl: string;
  reportKey: string;
  reportType: string;
  reportTypeLabel: string;
  originalName: string;
  isRead: boolean;
}>) {
  const typeStats = new Map<string, { value: string; total: number; unread: number }>();
  const categoryStats = new Map<string, { value: string; label: string; total: number; unread: number }>();
  const reportTypeStats = new Map<string, { value: string; label: string; total: number; unread: number }>();

  const bump = <T extends { total: number; unread: number }>(bucket: T, isRead: boolean) => {
    bucket.total += 1;
    if (!isRead) bucket.unread += 1;
  };

  for (const item of items) {
    if (item.type) {
      const stat = typeStats.get(item.type) || { value: item.type, total: 0, unread: 0 };
      bump(stat, item.isRead);
      typeStats.set(item.type, stat);
    }

    const categoryLabel = normalizeCategoryLabelForFeed(item);
    if (categoryLabel) {
      const stat = categoryStats.get(categoryLabel) || { value: categoryLabel, label: categoryLabel, total: 0, unread: 0 };
      bump(stat, item.isRead);
      categoryStats.set(categoryLabel, stat);
    }

    if (isHtmlReportLike(item)) {
      const reportMeta = inferReportType({
        title: item.title,
        category: item.category,
        reportKey: item.reportKey,
        originalName: item.originalName,
        reportType: item.reportType,
        reportTypeLabel: item.reportTypeLabel,
      });
      const stat = reportTypeStats.get(reportMeta.reportType) || {
        value: reportMeta.reportType,
        label: reportMeta.reportTypeLabel,
        total: 0,
        unread: 0,
      };
      stat.label = reportMeta.reportTypeLabel || stat.label;
      bump(stat, item.isRead);
      reportTypeStats.set(reportMeta.reportType, stat);
    }
  }

  return {
    types: Array.from(typeStats.values()).sort((a, b) => a.value.localeCompare(b.value)),
    categories: Array.from(categoryStats.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')),
    reportTypes: Array.from(reportTypeStats.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')),
  };
}

function getReferenceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }
  return fallback;
}

function parseReferenceData(value: unknown): any[] {
  if (!value) return [];
  let raw = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null;
      const refNumber = getReferenceNumber(
        (entry as any).refNumber ?? (entry as any).number ?? (entry as any).ref,
        index + 1,
      );
      if (!refNumber) return null;
      return {
        ...(entry as Record<string, unknown>),
        refNumber,
        ref: (entry as any).ref || `REF${refNumber}`,
        id: (entry as any).id || (entry as any).transcriptionId || (entry as any).noteId || '',
        title: (entry as any).title || (entry as any).fileName || (entry as any).name || '',
      };
    })
    .filter(Boolean);
}

function normalizeReferenceData(value: unknown): string {
  const parsed = parseReferenceData(value);
  return parsed.length ? JSON.stringify(parsed) : '';
}

function stripHtmlText(input = ''): string {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanReferenceTitle(input = ''): string {
  return stripHtmlText(input)
    .replace(/\[\s*REF\s*\d+\s*\]/gi, '')
    .replace(/^[-–—\s:：|｜]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeReferenceSearch(input = ''): string {
  return cleanReferenceTitle(input)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

function extractReferenceTextFromHtml(content: string, refNumber: number): string {
  if (!content) return '';

  const idPattern = new RegExp(`<[^>]+id=["']ref${refNumber}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const idMatch = content.match(idPattern);
  if (idMatch) return cleanReferenceTitle(idMatch[1]);

  const refPattern = new RegExp(`\\[\\s*REF\\s*${refNumber}\\s*\\]\\s*([^<\\n]+)`, 'i');
  const refMatch = content.match(refPattern);
  return refMatch ? cleanReferenceTitle(refMatch[0]) : '';
}

function referenceCandidates(reference: any, fallbackText = ''): string[] {
  const raw = [
    reference?.title,
    reference?.fileName,
    reference?.topic,
    reference?.refText,
    fallbackText,
  ].filter(Boolean).map(String);

  const expanded = raw.flatMap((text) => [
    text,
    ...cleanReferenceTitle(text).split(/[|｜]/g),
  ]);

  return Array.from(new Set(
    expanded
      .map(cleanReferenceTitle)
      .filter((text) => text.length >= 4),
  ));
}

function scoreTranscriptionAgainstReference(transcription: any, candidates: string[]): number {
  const titleParts = [
    transcription.fileName,
    transcription.topic,
    transcription.organization,
    transcription.industry,
  ].filter(Boolean).map((part) => normalizeReferenceSearch(String(part)));
  const title = normalizeReferenceSearch([transcription.industry, transcription.organization, transcription.fileName, transcription.topic].filter(Boolean).join(' '));

  let score = 0;
  for (const candidateText of candidates) {
    const candidate = normalizeReferenceSearch(candidateText);
    if (!candidate) continue;
    for (const part of titleParts) {
      if (!part) continue;
      if (part === candidate) score = Math.max(score, 120);
      else if (part.includes(candidate)) score = Math.max(score, 95);
      else if (candidate.includes(part) && part.length >= 6) score = Math.max(score, 85);
    }
    if (title.includes(candidate)) score = Math.max(score, 75);
    else if (candidate.includes(title) && title.length >= 8) score = Math.max(score, 70);
  }
  return score;
}

async function findTranscriptionForReference(userId: string, reference: any, fallbackText = '') {
  const referenceId = reference?.id || reference?.transcriptionId || reference?.noteId;
  if (referenceId) {
    const direct = await prisma.transcription.findFirst({
      where: { id: String(referenceId), userId },
    } as any);
    if (direct) return direct;
  }

  const candidates = referenceCandidates(reference, fallbackText);
  if (!candidates.length) return null;

  const transcriptions = await prisma.transcription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 1500,
    select: {
      id: true,
      fileName: true,
      topic: true,
      organization: true,
      industry: true,
      participants: true,
      eventDate: true,
      actualDate: true,
      createdAt: true,
      type: true,
      status: true,
      summary: true,
      translatedSummary: true,
    },
  } as any);

  const best = transcriptions
    .map((transcription: any) => ({
      transcription,
      score: scoreTranscriptionAgainstReference(transcription, candidates),
    }))
    .filter((entry: any) => entry.score > 0)
    .sort((a: any, b: any) => b.score - a.score)[0];

  return best?.transcription || null;
}

function buildReferencePreview(reference: any, transcription: any, refNumber: number, refText = '') {
  const title = transcription?.fileName || reference?.title || reference?.fileName || cleanReferenceTitle(refText) || `REF${refNumber}`;
  const metadata = {
    organization: transcription?.organization || reference?.organization || reference?.org || '',
    industry: transcription?.industry || reference?.industry || '',
    topic: transcription?.topic || reference?.topic || '',
    participants: transcription?.participants || reference?.participants || '',
    eventDate: transcription?.eventDate || reference?.eventDate || reference?.date || '',
  };
  const content = [
    transcription?.translatedSummary || reference?.translatedSummary,
    transcription?.summary || reference?.summary || reference?.content,
  ].filter(Boolean).join('\n\n---\n\n');

  return {
    id: transcription?.id || reference?.id || reference?.transcriptionId || reference?.noteId || `ref-${refNumber}`,
    canvasId: reference?.canvasId || '',
    workspaceId: reference?.workspaceId || '',
    workspaceName: reference?.workspaceName || '',
    title,
    content: content || reference?.content || '',
    date: transcription?.actualDate || transcription?.createdAt || reference?.date || null,
    metadata,
    sourceType: transcription ? 'aiprocess-transcription' : (reference?.sourceType || 'feed-reference'),
  };
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
      await prisma.$executeRawUnsafe('ALTER TABLE "FeedItem" ADD COLUMN IF NOT EXISTS "referenceData" TEXT NOT NULL DEFAULT \'\'');
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
  if (category) {
    where.category = isSummaryReportText(category)
      ? { in: SUMMARY_REPORT_CATEGORIES }
      : category;
  }
  if (reportKey) where.reportKey = reportKey;
  if (reportType) where.reportType = reportType;
  if (isRead !== undefined) where.isRead = isRead === 'true';
  if (isStarred !== undefined) where.isStarred = isStarred === 'true';

  const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(pageSize);
  const take = Math.min(200, parseInt(pageSize));

  const metaWhere = { userId };

  const [items, total, metaItems] = await Promise.all([
    prisma.feedItem.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip,
      take,
    }),
    prisma.feedItem.count({ where }),
    prisma.feedItem.findMany({
      where: metaWhere,
      select: {
        type: true,
        category: true,
        title: true,
        contentFormat: true,
        htmlUrl: true,
        reportKey: true,
        reportType: true,
        reportTypeLabel: true,
        originalName: true,
        isRead: true,
      },
    }),
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
    referenceData: parseReferenceData((item as any).referenceData),
  }));

  return res.json({ success: true, data: parsed, total, page: parseInt(page), pageSize: take, meta: buildFeedMeta(metaItems) });
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
    referenceData,
    references,
    mode,
  } = req.body;

  if (!type || !title || !content) {
    return res.status(400).json({ success: false, error: '缺少必填字段: type, title, content' });
  }

  const format = normalizeFormat(contentFormat);
  const typeHints = format === 'html'
    ? [type, category, reportType, reportTypeLabel, title]
    : [type, category, reportType, reportTypeLabel];
  const normalizedType = isSummaryReportText(...typeHints)
    ? 'weekly'
    : normalizeFeedType(type, 'news');
  const normalizedCategory = isSummaryReportText(category) ? SUMMARY_REPORT_LABEL : (category || '');
  const reportMeta = format === 'html'
    ? inferReportType({ title, category, reportKey, originalName, reportType, reportTypeLabel })
    : { reportType: reportType || '', reportTypeLabel: reportTypeLabel || '' };

  const data = {
    userId,
    type: normalizedType,
    category: normalizedCategory,
    title,
    content: format === 'html' ? normalizeHtmlReport(content) : content,
    contentFormat: format,
    source: source || '',
    tags: JSON.stringify(parseTags(tags)),
    reportKey: reportKey || '',
    reportVersion: reportVersion || '',
    reportType: reportMeta.reportType,
    reportTypeLabel: reportMeta.reportTypeLabel,
    originalName: originalName || '',
    htmlUrl: htmlUrl || '',
    referenceData: normalizeReferenceData(referenceData ?? references),
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
      return res.json({ success: true, data: { ...item, tags: parseTags(item.tags), referenceData: parseReferenceData((item as any).referenceData) }, upserted: true });
    }
  }

  const item = await prisma.feedItem.create({ data });

  return res.status(201).json({ success: true, data: { ...item, tags: parseTags(item.tags), referenceData: parseReferenceData((item as any).referenceData) } });
}

/**
 * POST /api/feed/html-report — 创建或更新 HTML 报告信息流条目
 */
export async function createHtmlReport(req: Request, res: Response) {
  await ensureFeedSchema();
  const {
    type,
    feedType,
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
    referenceData,
    references,
    mode = 'create',
    preserveHistory = true,
    publishedAt,
  } = req.body;

  if (!title || !html) {
    return res.status(400).json({ success: false, error: '缺少必填字段: title, html' });
  }

  const typeHint = [type, feedType, category, reportType, reportTypeLabel, title].filter(Boolean).join(' ');
  const inferredType = isSummaryReportText(typeHint)
    ? 'weekly'
    : normalizeFeedType(type || feedType, 'report');

  req.body = {
    type: inferredType,
    title,
    content: normalizeHtmlReport(html),
    contentFormat: 'html',
    category: isSummaryReportText(category) ? SUMMARY_REPORT_LABEL : (category || ''),
    source: source || '',
    tags,
    reportKey: reportKey || title,
    reportVersion: reportVersion || new Date().toISOString(),
    reportType,
    reportTypeLabel,
    originalName: originalName || '',
    htmlUrl: htmlUrl || '',
    referenceData: referenceData ?? references,
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
    type,
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
    referenceData,
    references,
  } = req.body;

  const item = await prisma.feedItem.findUnique({ where: { id } });
  if (!item || item.userId !== userId) {
    return res.status(404).json({ success: false, error: '未找到' });
  }

  const updates: any = {};
  if (type !== undefined) updates.type = normalizeFeedType(type, item.type);
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
  if (referenceData !== undefined || references !== undefined) updates.referenceData = normalizeReferenceData(referenceData ?? references);

  const updated = await prisma.feedItem.update({ where: { id }, data: updates });
  return res.json({ success: true, data: { ...updated, tags: parseTags(updated.tags), referenceData: parseReferenceData((updated as any).referenceData) } });
}

/**
 * POST /api/feed/:id/reference/:refNumber — 解析报告 REF 到对应来源
 */
export async function getReference(req: Request, res: Response) {
  await ensureFeedSchema();
  const userId = req.userId!;
  const { id, refNumber: refNumberParam } = req.params;
  const refNumber = parseInt(refNumberParam, 10);
  const refText = typeof req.body?.refText === 'string' ? req.body.refText : '';

  if (!Number.isFinite(refNumber) || refNumber <= 0) {
    return res.status(400).json({ success: false, error: 'refNumber 无效' });
  }

  const item = await prisma.feedItem.findUnique({ where: { id } });
  if (!item || item.userId !== userId) {
    return res.status(404).json({ success: false, error: '未找到信息流条目' });
  }

  const references = parseReferenceData((item as any).referenceData);
  let reference = references.find((entry) => Number(entry.refNumber) === refNumber);
  const htmlReferenceText = extractReferenceTextFromHtml(item.content, refNumber);

  if (!reference && htmlReferenceText) {
    reference = { refNumber, ref: `REF${refNumber}`, title: htmlReferenceText, refText: htmlReferenceText };
  }

  const effectiveRefText = reference?.title || reference?.refText || htmlReferenceText || refText || `REF${refNumber}`;
  const transcription = await findTranscriptionForReference(userId, reference || { refNumber, title: effectiveRefText }, effectiveRefText);

  if (!reference && !transcription) {
    return res.json({
      success: true,
      refNumber,
      refText: effectiveRefText,
      direct: false,
      note: null,
      canOpenInAIProcess: false,
    });
  }

  const note = buildReferencePreview(reference || { refNumber, title: effectiveRefText }, transcription, refNumber, effectiveRefText);
  return res.json({
    success: true,
    refNumber,
    refText: effectiveRefText,
    direct: Boolean(reference?.id || references.length),
    note,
    canOpenInAIProcess: Boolean(transcription),
  });
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
