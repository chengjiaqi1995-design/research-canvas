import { Request, Response } from 'express';
import prisma from '../utils/db';

// ─── Bulk GET/PUT (backward compatible with existing client) ───

/** GET /api/wiki — fetch all wiki data for the current user */
export async function getAll(req: Request, res: Response) {
  const userId = req.userId!;

  const [articles, actions] = await Promise.all([
    prisma.wikiArticle.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    prisma.wikiAction.findMany({ where: { userId }, orderBy: { timestamp: 'desc' }, take: 500 }),
  ]);

  const parsed = articles.map(a => ({
    ...a,
    tags: (() => { try { return JSON.parse(a.tags); } catch { return []; } })(),
    createdAt: a.createdAt.getTime(),
    updatedAt: a.updatedAt.getTime(),
  }));

  const parsedActions = actions.map(a => ({
    ...a,
    timestamp: a.timestamp.getTime(),
  }));

  return res.json({ articles: parsed, actions: parsedActions });
}

/** PUT /api/wiki — bulk save (upsert all articles + actions) */
export async function saveAll(req: Request, res: Response) {
  const userId = req.userId!;
  const { articles = [], actions = [], wikiPageTypes } = req.body;

  // Delete existing and re-insert (simple bulk sync)
  await prisma.$transaction([
    prisma.wikiArticle.deleteMany({ where: { userId } }),
    prisma.wikiAction.deleteMany({ where: { userId } }),
    ...articles.map((a: any) =>
      prisma.wikiArticle.create({
        data: {
          id: a.id,
          userId,
          industryCategory: a.industryCategory,
          title: a.title,
          description: a.description || '',
          content: a.content || '',
          tags: Array.isArray(a.tags) ? JSON.stringify(a.tags) : (a.tags || '[]'),
          createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
          updatedAt: a.updatedAt ? new Date(a.updatedAt) : new Date(),
        },
      })
    ),
    ...actions.slice(0, 500).map((a: any) =>
      prisma.wikiAction.create({
        data: {
          id: a.id,
          userId,
          industryCategory: a.industryCategory,
          action: a.action,
          articleTitle: a.articleTitle,
          description: a.description || '',
          timestamp: a.timestamp ? new Date(a.timestamp) : new Date(),
        },
      })
    ),
  ]);

  return res.json({ ok: true });
}

// ─── Granular CRUD (for MCP / agent use) ───

/** GET /api/wiki/articles?scope=xxx — list articles, optionally filtered by scope */
export async function listArticles(req: Request, res: Response) {
  const userId = req.userId!;
  const { scope } = req.query;

  const where: any = { userId };
  if (scope) where.industryCategory = scope as string;

  const articles = await prisma.wikiArticle.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: { id: true, industryCategory: true, title: true, description: true, updatedAt: true },
  });

  const result = articles.map(a => ({
    ...a,
    updatedAt: a.updatedAt.getTime(),
  }));

  return res.json({ success: true, data: result });
}

/** GET /api/wiki/articles/:id — read a single article with full content */
export async function getArticle(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const article = await prisma.wikiArticle.findUnique({ where: { id } });
  if (!article || article.userId !== userId) {
    return res.status(404).json({ success: false, error: '文章不存在' });
  }

  return res.json({
    success: true,
    data: {
      ...article,
      tags: (() => { try { return JSON.parse(article.tags); } catch { return []; } })(),
      createdAt: article.createdAt.getTime(),
      updatedAt: article.updatedAt.getTime(),
    },
  });
}

/** POST /api/wiki/articles — create a new article */
export async function createArticle(req: Request, res: Response) {
  const userId = req.userId!;
  const { industryCategory, title, content, description, tags } = req.body;

  if (!industryCategory || !title) {
    return res.status(400).json({ success: false, error: '缺少 industryCategory 或 title' });
  }

  const article = await prisma.wikiArticle.create({
    data: {
      userId,
      industryCategory,
      title,
      description: description || '',
      content: content || '',
      tags: Array.isArray(tags) ? JSON.stringify(tags) : '[]',
    },
  });

  // Auto-log
  await prisma.wikiAction.create({
    data: { userId, industryCategory, action: 'create', articleTitle: title, description: description || '' },
  });

  return res.status(201).json({
    success: true,
    data: {
      ...article,
      tags: (() => { try { return JSON.parse(article.tags); } catch { return []; } })(),
      createdAt: article.createdAt.getTime(),
      updatedAt: article.updatedAt.getTime(),
    },
  });
}

/** PUT /api/wiki/articles/:id — update article (full replace) */
export async function updateArticle(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { title, content, description, tags } = req.body;

  const existing = await prisma.wikiArticle.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ success: false, error: '文章不存在' });
  }

  const updates: any = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (description !== undefined) updates.description = description;
  if (tags !== undefined) updates.tags = Array.isArray(tags) ? JSON.stringify(tags) : tags;

  const updated = await prisma.wikiArticle.update({ where: { id }, data: updates });

  // Auto-log
  await prisma.wikiAction.create({
    data: {
      userId,
      industryCategory: existing.industryCategory,
      action: 'update',
      articleTitle: title || existing.title,
      description: description || '',
    },
  });

  return res.json({
    success: true,
    data: {
      ...updated,
      tags: (() => { try { return JSON.parse(updated.tags); } catch { return []; } })(),
      createdAt: updated.createdAt.getTime(),
      updatedAt: updated.updatedAt.getTime(),
    },
  });
}

/** PATCH /api/wiki/articles/:id/section — edit a specific markdown section */
export async function editSection(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { sectionTitle, newContent, mode } = req.body;
  // mode: "replace" (default) | "append" | "prepend"

  if (!sectionTitle || newContent === undefined) {
    return res.status(400).json({ success: false, error: '缺少 sectionTitle 或 newContent' });
  }

  const article = await prisma.wikiArticle.findUnique({ where: { id } });
  if (!article || article.userId !== userId) {
    return res.status(404).json({ success: false, error: '文章不存在' });
  }

  // Parse markdown sections (## heading)
  const content = article.content;
  const sectionRegex = new RegExp(`(## ${escapeRegex(sectionTitle)}[^\n]*\n)([\\s\\S]*?)(?=\n## |$)`);
  const match = content.match(sectionRegex);

  let updatedContent: string;
  if (match) {
    const heading = match[1];
    const existingBody = match[2];
    let newBody: string;
    if (mode === 'append') {
      newBody = existingBody.trimEnd() + '\n' + newContent + '\n';
    } else if (mode === 'prepend') {
      newBody = newContent + '\n' + existingBody;
    } else {
      newBody = newContent + '\n';
    }
    updatedContent = content.replace(match[0], heading + newBody);
  } else {
    // Section doesn't exist — append new section at end
    updatedContent = content.trimEnd() + '\n\n## ' + sectionTitle + '\n' + newContent + '\n';
  }

  const updated = await prisma.wikiArticle.update({
    where: { id },
    data: { content: updatedContent },
  });

  return res.json({
    success: true,
    data: {
      ...updated,
      tags: (() => { try { return JSON.parse(updated.tags); } catch { return []; } })(),
      createdAt: updated.createdAt.getTime(),
      updatedAt: updated.updatedAt.getTime(),
    },
  });
}

/** DELETE /api/wiki/articles/:id — delete an article */
export async function deleteArticle(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const article = await prisma.wikiArticle.findUnique({ where: { id } });
  if (!article || article.userId !== userId) {
    return res.status(404).json({ success: false, error: '文章不存在' });
  }

  await prisma.wikiArticle.delete({ where: { id } });

  // Auto-log
  await prisma.wikiAction.create({
    data: {
      userId,
      industryCategory: article.industryCategory,
      action: 'delete',
      articleTitle: article.title,
      description: '文章已删除',
    },
  });

  return res.json({ success: true });
}

/** GET /api/wiki/actions?scope=xxx — list recent actions */
export async function listActions(req: Request, res: Response) {
  const userId = req.userId!;
  const { scope, limit } = req.query;

  const where: any = { userId };
  if (scope) where.industryCategory = scope as string;

  const actions = await prisma.wikiAction.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(500, parseInt(limit as string) || 30),
  });

  return res.json({
    success: true,
    data: actions.map(a => ({ ...a, timestamp: a.timestamp.getTime() })),
  });
}

/** POST /api/wiki/actions — log an action */
export async function createAction(req: Request, res: Response) {
  const userId = req.userId!;
  const { industryCategory, action, articleTitle, description } = req.body;

  if (!industryCategory || !action || !articleTitle) {
    return res.status(400).json({ success: false, error: '缺少必填字段' });
  }

  const created = await prisma.wikiAction.create({
    data: { userId, industryCategory, action, articleTitle, description: description || '' },
  });

  return res.json({ success: true, data: { ...created, timestamp: created.timestamp.getTime() } });
}

// ─── Generation History (实验记录) ───

/** POST /api/wiki/generation-logs — save a generation log entry */
export async function createGenerationLog(req: Request, res: Response) {
  const userId = req.userId!;
  const { industryCategory, model, promptTemplate, pageTypes, sourceCount, sourceSummary, generatedArticles, label, note } = req.body;

  if (!industryCategory || !model || !promptTemplate) {
    return res.status(400).json({ success: false, error: '缺少必填字段 (industryCategory, model, promptTemplate)' });
  }

  const log = await prisma.wikiGenerationLog.create({
    data: {
      userId,
      industryCategory,
      model,
      promptTemplate,
      pageTypes: pageTypes || '',
      sourceCount: sourceCount || 0,
      sourceSummary: sourceSummary || '',
      generatedArticles: typeof generatedArticles === 'string' ? generatedArticles : JSON.stringify(generatedArticles || []),
      label: label || '',
      note: note || '',
    },
  });

  return res.status(201).json({ success: true, data: { ...log, createdAt: log.createdAt.getTime() } });
}

/** GET /api/wiki/generation-logs?scope=xxx — list generation logs */
export async function listGenerationLogs(req: Request, res: Response) {
  const userId = req.userId!;
  const { scope, limit } = req.query;

  const where: any = { userId };
  if (scope) where.industryCategory = scope as string;

  const logs = await prisma.wikiGenerationLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, parseInt(limit as string) || 50),
    select: {
      id: true,
      industryCategory: true,
      model: true,
      sourceCount: true,
      sourceSummary: true,
      label: true,
      note: true,
      createdAt: true,
    },
  });

  return res.json({
    success: true,
    data: logs.map(l => ({ ...l, createdAt: l.createdAt.getTime() })),
  });
}

/** GET /api/wiki/generation-logs/:id — read a single log with full content */
export async function getGenerationLog(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const log = await prisma.wikiGenerationLog.findUnique({ where: { id } });
  if (!log || log.userId !== userId) {
    return res.status(404).json({ success: false, error: '记录不存在' });
  }

  return res.json({
    success: true,
    data: {
      ...log,
      generatedArticles: (() => { try { return JSON.parse(log.generatedArticles); } catch { return []; } })(),
      createdAt: log.createdAt.getTime(),
    },
  });
}

/** PATCH /api/wiki/generation-logs/:id — update label/note */
export async function updateGenerationLog(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { label, note } = req.body;

  const existing = await prisma.wikiGenerationLog.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ success: false, error: '记录不存在' });
  }

  const updates: any = {};
  if (label !== undefined) updates.label = label;
  if (note !== undefined) updates.note = note;

  const updated = await prisma.wikiGenerationLog.update({ where: { id }, data: updates });
  return res.json({ success: true, data: { ...updated, createdAt: updated.createdAt.getTime() } });
}

/** DELETE /api/wiki/generation-logs/:id — delete a log */
export async function deleteGenerationLog(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const existing = await prisma.wikiGenerationLog.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(404).json({ success: false, error: '记录不存在' });
  }

  await prisma.wikiGenerationLog.delete({ where: { id } });
  return res.json({ success: true });
}

// Helper
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
