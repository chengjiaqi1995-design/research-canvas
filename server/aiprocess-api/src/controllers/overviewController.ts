import { Request, Response } from 'express';
import prisma from '../utils/db';

type ModuleKey = 'canvas' | 'ai_process' | 'portfolio' | 'tracker' | 'feed' | 'ai_library';
type OverviewSource = 'event' | 'timestamp';

const MODULE_LABELS: Record<ModuleKey, string> = {
  canvas: 'Canvas',
  ai_process: 'AI Process',
  portfolio: 'Portfolio',
  tracker: '行业看板',
  feed: '信息流',
  ai_library: '能力库',
};

const MODULE_KEYS: ModuleKey[] = ['canvas', 'ai_process', 'portfolio', 'tracker', 'feed', 'ai_library'];
const SINGAPORE_OFFSET = '+08:00';

function parseJson(value: unknown, fallback: any = {}) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function dayBounds(dateValue: string) {
  const todayParts = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : todayParts();
  const start = new Date(`${normalized}T00:00:00${SINGAPORE_OFFSET}`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { date: normalized, start, end };
}

function initializeTotals() {
  return Object.fromEntries(
    MODULE_KEYS.map((key) => [key, { created: 0, updated: 0, deleted: 0, total: 0 }]),
  ) as Record<ModuleKey, { created: number; updated: number; deleted: number; total: number }>;
}

function initializeModules(): Record<ModuleKey, any[]> {
  return {
    canvas: [],
    ai_process: [],
    portfolio: [],
    tracker: [],
    feed: [],
    ai_library: [],
  };
}

function countAction(totals: ReturnType<typeof initializeTotals>, item: any) {
  const bucket = totals[item.module as ModuleKey];
  if (!bucket) return;
  if (item.action === 'created' || item.action === 'imported' || item.action === 'generated') bucket.created += 1;
  else if (item.action === 'deleted') bucket.deleted += 1;
  else bucket.updated += 1;
  bucket.total += 1;
}

function addItem(modules: ReturnType<typeof initializeModules>, totals: ReturnType<typeof initializeTotals>, item: any) {
  const moduleKey = item.module as ModuleKey;
  modules[moduleKey].push(item);
  countAction(totals, item);
}

function eventKey(item: { module: string; entityType: string; entityId: string; action: string }) {
  return `${item.module}:${item.entityType}:${item.entityId}:${item.action}`;
}

function buildTimestampItem(input: {
  module: ModuleKey;
  entityType: string;
  entityId: string | number;
  action: string;
  title: string;
  summary?: string;
  location?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: `timestamp:${input.module}:${input.entityType}:${input.entityId}:${input.action}:${input.occurredAt.getTime()}`,
    module: input.module,
    moduleLabel: MODULE_LABELS[input.module],
    entityType: input.entityType,
    entityId: String(input.entityId),
    action: input.action,
    title: input.title || '(无标题)',
    summary: input.summary || '',
    location: input.location || '',
    occurredAt: input.occurredAt.toISOString(),
    source: 'timestamp' as OverviewSource,
    metadata: input.metadata || {},
  };
}

function isWithin(date: Date | null | undefined, start: Date, end: Date) {
  if (!date) return false;
  const ms = new Date(date).getTime();
  return ms >= start.getTime() && ms < end.getTime();
}

export async function createActivityEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const body = req.body || {};
  const moduleKey = String(body.module || '').trim();
  const entityType = String(body.entityType || '').trim();
  const entityId = String(body.entityId || '').trim();
  const action = String(body.action || '').trim();
  const title = String(body.title || '').trim();
  if (!moduleKey || !entityType || !entityId || !action || !title) {
    return res.status(400).json({ success: false, error: 'module/entityType/entityId/action/title are required' });
  }

  const event = await (prisma as any).activityEvent.create({
    data: {
      userId,
      module: moduleKey,
      entityType,
      entityId,
      action,
      title,
      summary: body.summary ? String(body.summary) : '',
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      metadataJson: JSON.stringify(body.metadata || {}),
      actorEmail: req.actorEmail || body.actorEmail || null,
    },
  });

  res.json({ success: true, event });
}

export async function getDbDailyOverview(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { date, start, end } = dayBounds(String(req.query.date || ''));
  const activityEventQuery = (prisma as any).activityEvent?.findMany
    ? (prisma as any).activityEvent.findMany({
      where: { userId, occurredAt: { gte: start, lt: end } },
      orderBy: { occurredAt: 'desc' },
      take: 1000,
    }).catch(() => [])
    : Promise.resolve([]);

  const modules = initializeModules();
  const totals = initializeTotals();

  const [
    exactEvents,
    transcriptions,
    positions,
    researches,
    trades,
    imports,
    feedItems,
    impacts,
    alerts,
    wikiActions,
    wikiLogs,
    wikiArticles,
  ] = await Promise.all([
    activityEventQuery,
    prisma.transcription.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
      select: { id: true, fileName: true, type: true, status: true, createdAt: true, updatedAt: true, actualDate: true, organization: true, industry: true, participants: true },
    } as any),
    prisma.portfolioPosition.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
      select: { id: true, tickerBbg: true, nameEn: true, nameCn: true, positionWeight: true, createdAt: true, updatedAt: true },
    } as any),
    prisma.portfolioResearch.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      include: { position: { select: { tickerBbg: true, nameEn: true, nameCn: true } } },
    } as any),
    prisma.portfolioTrade.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { executedAt: { gte: start, lt: end } }] },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, status: true, note: true, createdAt: true, executedAt: true },
    } as any),
    prisma.portfolioImportHistory.findMany({
      where: { userId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    } as any),
    prisma.feedItem.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { pushedAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
      orderBy: { pushedAt: 'desc' },
      take: 1000,
      select: { id: true, title: true, type: true, category: true, source: true, createdAt: true, updatedAt: true, pushedAt: true, publishedAt: true },
    } as any),
    prisma.portfolioFeedImpact.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      include: { position: { select: { tickerBbg: true, nameEn: true, nameCn: true } }, feedItem: { select: { title: true } } },
    } as any),
    prisma.portfolioImpactAlert.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      include: { position: { select: { tickerBbg: true, nameEn: true, nameCn: true } } },
    } as any),
    prisma.wikiAction.findMany({
      where: { userId, timestamp: { gte: start, lt: end } },
      orderBy: { timestamp: 'desc' },
      take: 500,
    } as any),
    prisma.wikiGenerationLog.findMany({
      where: { userId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, industryCategory: true, model: true, sourceCount: true, label: true, createdAt: true },
    } as any),
    prisma.wikiArticle.findMany({
      where: { userId, OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }] },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      select: { id: true, industryCategory: true, title: true, createdAt: true, updatedAt: true },
    } as any),
  ]);

  const exactKeys = new Set<string>();
  for (const event of exactEvents || []) {
    const item = {
      id: `event:${event.id}`,
      module: event.module,
      moduleLabel: MODULE_LABELS[event.module as ModuleKey] || event.module,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      title: event.title,
      summary: event.summary || '',
      location: '',
      occurredAt: event.occurredAt.toISOString(),
      source: 'event' as OverviewSource,
      metadata: parseJson(event.metadataJson, {}),
    };
    exactKeys.add(eventKey(item));
    if (MODULE_KEYS.includes(item.module as ModuleKey)) addItem(modules, totals, item);
  }

  const addTimestamp = (item: ReturnType<typeof buildTimestampItem>) => {
    if (exactKeys.has(eventKey(item))) return;
    addItem(modules, totals, item);
  };

  for (const t of transcriptions) {
    const created = isWithin(t.createdAt, start, end);
    addTimestamp(buildTimestampItem({
      module: 'ai_process',
      entityType: 'transcription',
      entityId: t.id,
      action: created ? 'created' : 'updated',
      title: t.fileName,
      summary: [t.type, t.status, t.organization, t.industry, t.participants].filter(Boolean).join(' · '),
      location: t.actualDate ? `发生日 ${new Date(t.actualDate).toISOString().slice(0, 10)}` : '',
      occurredAt: created ? t.createdAt : t.updatedAt,
    }));
  }

  for (const p of positions) {
    const created = isWithin(p.createdAt, start, end);
    addTimestamp(buildTimestampItem({
      module: 'portfolio',
      entityType: 'position',
      entityId: p.id,
      action: created ? 'created' : 'updated',
      title: p.nameEn || p.nameCn || p.tickerBbg,
      summary: `${p.tickerBbg}${p.positionWeight ? ` · ${(p.positionWeight * 100).toFixed(1)}%` : ''}`,
      occurredAt: created ? p.createdAt : p.updatedAt,
    }));
  }

  for (const raw of researches) {
    const r = raw as any;
    const created = isWithin(r.createdAt, start, end);
    addTimestamp(buildTimestampItem({
      module: 'portfolio',
      entityType: 'research',
      entityId: r.id,
      action: created ? 'created' : 'updated',
      title: r.position?.nameEn || r.position?.nameCn || r.position?.tickerBbg || `Research ${r.id}`,
      summary: 'Portfolio research 字段更新',
      occurredAt: created ? r.createdAt : r.updatedAt,
    }));
  }

  for (const trade of trades) {
    addTimestamp(buildTimestampItem({
      module: 'portfolio',
      entityType: 'trade',
      entityId: trade.id,
      action: trade.executedAt && isWithin(trade.executedAt, start, end) ? 'updated' : 'created',
      title: `Trade #${trade.id}`,
      summary: [trade.status, trade.note].filter(Boolean).join(' · '),
      occurredAt: trade.executedAt && isWithin(trade.executedAt, start, end) ? trade.executedAt : trade.createdAt,
    }));
  }

  for (const item of imports) {
    addTimestamp(buildTimestampItem({
      module: 'portfolio',
      entityType: 'import',
      entityId: item.id,
      action: 'imported',
      title: item.fileName,
      summary: `${item.importType} · ${item.recordCount} 条 · 新增 ${item.newCount} · 更新 ${item.updatedCount}`,
      occurredAt: item.createdAt,
    }));
  }

  for (const item of feedItems) {
    const created = isWithin(item.createdAt, start, end) || isWithin(item.pushedAt, start, end);
    addTimestamp(buildTimestampItem({
      module: 'feed',
      entityType: 'feedItem',
      entityId: item.id,
      action: created ? 'created' : 'updated',
      title: item.title,
      summary: [item.type, item.category, item.source].filter(Boolean).join(' · '),
      occurredAt: created ? (item.pushedAt || item.createdAt) : item.updatedAt,
    }));
  }

  for (const raw of impacts) {
    const impact = raw as any;
    const created = isWithin(impact.createdAt, start, end);
    addTimestamp(buildTimestampItem({
      module: 'portfolio',
      entityType: 'feedImpact',
      entityId: impact.id,
      action: created ? 'created' : 'updated',
      title: impact.position?.nameEn || impact.position?.tickerBbg || 'Portfolio impact',
      summary: [impact.feedItem?.title, impact.fundamentalDirection, impact.portfolioDirection].filter(Boolean).join(' · '),
      occurredAt: created ? impact.createdAt : impact.updatedAt,
    }));
  }

  for (const raw of alerts) {
    const alert = raw as any;
    const created = isWithin(alert.createdAt, start, end);
    addTimestamp(buildTimestampItem({
      module: 'portfolio',
      entityType: 'impactAlert',
      entityId: alert.id,
      action: created ? 'created' : 'updated',
      title: alert.position?.nameEn || alert.position?.tickerBbg || 'Impact alert',
      summary: [alert.severity, alert.status, alert.message].filter(Boolean).join(' · '),
      occurredAt: created ? alert.createdAt : alert.updatedAt,
    }));
  }

  for (const action of wikiActions) {
    addTimestamp(buildTimestampItem({
      module: 'tracker',
      entityType: 'wikiAction',
      entityId: action.id,
      action: action.action || 'updated',
      title: action.articleTitle,
      summary: action.description || '',
      location: action.industryCategory,
      occurredAt: action.timestamp,
    }));
  }

  for (const log of wikiLogs) {
    addTimestamp(buildTimestampItem({
      module: 'tracker',
      entityType: 'wikiGenerationLog',
      entityId: log.id,
      action: 'generated',
      title: log.label || `${log.industryCategory} 生成记录`,
      summary: `${log.model} · ${log.sourceCount} sources`,
      location: log.industryCategory,
      occurredAt: log.createdAt,
    }));
  }

  for (const article of wikiArticles) {
    const created = isWithin(article.createdAt, start, end);
    addTimestamp(buildTimestampItem({
      module: 'tracker',
      entityType: 'wikiArticle',
      entityId: article.id,
      action: created ? 'created' : 'updated',
      title: article.title,
      location: article.industryCategory,
      occurredAt: created ? article.createdAt : article.updatedAt,
    }));
  }

  const timeline = MODULE_KEYS.flatMap((key) => modules[key])
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  for (const key of MODULE_KEYS) {
    modules[key].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }

  res.json({
    success: true,
    date,
    totals,
    modules,
    timeline,
    coverage: {
      activityEvents: exactEvents?.length ? 'exact' : 'empty',
      aiProcess: 'timestamp',
      portfolio: 'timestamp',
      feed: 'timestamp',
      industryWiki: 'timestamp',
    },
  });
}
