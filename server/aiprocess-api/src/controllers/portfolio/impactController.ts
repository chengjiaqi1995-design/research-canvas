import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import prisma from '../../utils/db';

type Direction = 'positive' | 'negative' | 'neutral' | 'mixed';
type ImpactAnalyzer = 'agent-direct-v1' | 'llm-gemini-v1' | 'deterministic-v1';

interface FeedRow {
  id: string;
  type: string;
  category: string;
  title: string;
  content: string;
  contentFormat: string;
  source: string;
  tags: string;
  publishedAt: Date;
  updatedAt: Date;
}

interface PositionRow {
  id: number;
  tickerBbg: string;
  nameEn: string;
  nameCn: string;
  market: string;
  priority: string;
  longShort: string;
  positionAmount: number;
  positionWeight: number;
  sectorName: string;
  sectorRelationName: string;
  themeName: string;
  topdownName: string;
  gicIndustry: string;
  exchangeCountry: string;
}

interface ImpactCandidate {
  position: PositionRow;
  relevanceScore: number;
  fundamentalDirection: Direction;
  fundamentalScore: number;
  portfolioDirection: Direction;
  portfolioScore: number;
  horizon: string;
  channel: string;
  confidence: number;
  thesis: string;
  evidence: Record<string, unknown>;
}

interface CandidatePair {
  id: string;
  feed: FeedRow;
  candidate: ImpactCandidate;
}

interface AlertCandidate {
  severity: 'critical' | 'warning' | 'watch';
  alertType: string;
  message: string;
}

const LLM_ANALYZER: ImpactAnalyzer = 'llm-gemini-v1';
const DIRECT_AGENT_ANALYZER: ImpactAnalyzer = 'agent-direct-v1';
const DETERMINISTIC_ANALYZER: ImpactAnalyzer = 'deterministic-v1';
const DEFAULT_LLM_MODEL = process.env.PORTFOLIO_IMPACT_MODEL || 'gemini-3-flash-preview';

let impactSchemaReady: Promise<void> | null = null;

export async function ensureImpactSchema() {
  if (!impactSchemaReady) {
    impactSchemaReady = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PortfolioFeedImpact" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "feedItemId" TEXT NOT NULL REFERENCES "FeedItem"("id") ON DELETE CASCADE,
          "positionId" INTEGER NOT NULL REFERENCES "PortfolioPosition"("id") ON DELETE CASCADE,
          "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "fundamentalDirection" TEXT NOT NULL DEFAULT 'neutral',
          "fundamentalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "portfolioDirection" TEXT NOT NULL DEFAULT 'neutral',
          "portfolioScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "horizon" TEXT NOT NULL DEFAULT '1m',
          "channel" TEXT NOT NULL DEFAULT 'macro',
          "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
          "thesis" TEXT NOT NULL DEFAULT '',
          "evidenceJson" TEXT NOT NULL DEFAULT '{}',
          "status" TEXT NOT NULL DEFAULT 'new',
          "reviewedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PortfolioImpactAlert" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "impactId" TEXT NOT NULL REFERENCES "PortfolioFeedImpact"("id") ON DELETE CASCADE,
          "positionId" INTEGER NOT NULL REFERENCES "PortfolioPosition"("id") ON DELETE CASCADE,
          "severity" TEXT NOT NULL DEFAULT 'watch',
          "alertType" TEXT NOT NULL DEFAULT 'watch',
          "message" TEXT NOT NULL DEFAULT '',
          "status" TEXT NOT NULL DEFAULT 'open',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "PortfolioFeedImpact_feed_position_key" ON "PortfolioFeedImpact" ("feedItemId", "positionId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioFeedImpact_userId_idx" ON "PortfolioFeedImpact" ("userId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioFeedImpact_positionId_idx" ON "PortfolioFeedImpact" ("positionId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioFeedImpact_feedItemId_idx" ON "PortfolioFeedImpact" ("feedItemId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioFeedImpact_createdAt_idx" ON "PortfolioFeedImpact" ("createdAt")');
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "PortfolioImpactAlert_impact_type_key" ON "PortfolioImpactAlert" ("impactId", "alertType")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioImpactAlert_userId_idx" ON "PortfolioImpactAlert" ("userId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioImpactAlert_positionId_idx" ON "PortfolioImpactAlert" ("positionId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioImpactAlert_severity_idx" ON "PortfolioImpactAlert" ("severity")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PortfolioImpactAlert_status_idx" ON "PortfolioImpactAlert" ("status")');
    })().catch((err) => {
      impactSchemaReady = null;
      throw err;
    });
  }
  return impactSchemaReady;
}

function stripHtml(value: string) {
  return (value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value: string) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string) {
  return normalize(value).replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function truncate(value: string, maxLength: number) {
  const clean = stripHtml(value || '');
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}...`;
}

function directionFromScore(score: number, mixed = false): Direction {
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return mixed ? 'mixed' : 'neutral';
}

function normalizeDirection(value: unknown, fallback: Direction = 'neutral'): Direction {
  const raw = String(value || '').toLowerCase();
  if (raw === 'positive' || raw.includes('正')) return 'positive';
  if (raw === 'negative' || raw.includes('负')) return 'negative';
  if (raw === 'mixed' || raw.includes('混')) return 'mixed';
  if (raw === 'neutral' || raw.includes('中')) return 'neutral';
  return fallback;
}

function normalizeChannel(value: unknown, fallback: string) {
  const raw = String(value || '').trim().toLowerCase();
  const allowed = new Set(['revenue', 'margin', 'valuation', 'policy', 'competition', 'supply_chain', 'macro', 'liquidity']);
  return allowed.has(raw) ? raw : fallback;
}

function normalizeHorizon(value: unknown, fallback: string) {
  const raw = String(value || '').trim();
  return ['1d', '1w', '1m', '1q', 'long_term'].includes(raw) ? raw : fallback;
}

function sideFromPosition(position: PositionRow) {
  const raw = (position.longShort || '').toLowerCase();
  if (raw.includes('short')) return 'short';
  if (raw.includes('watch') || raw === '/' || raw === '') return 'watchlist';
  return 'long';
}

function textIncludes(compactedText: string, term: string) {
  const c = compact(term);
  return c.length >= 2 && compactedText.includes(c);
}

function addUnique(values: string[], value?: string | null) {
  const cleaned = (value || '').trim();
  if (!cleaned) return;
  if (!values.some((v) => v.toLowerCase() === cleaned.toLowerCase())) values.push(cleaned);
}

function buildDirectTerms(position: PositionRow) {
  const terms: { term: string; label: string; score: number }[] = [];
  if ((position.nameCn || '').trim().length >= 2) {
    terms.push({ term: position.nameCn, label: '中文名', score: 96 });
  }

  const nameEn = (position.nameEn || '').replace(/\b(inc|ltd|limited|corp|corporation|company|co|plc|ord|class|equity)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (nameEn.length >= 4) terms.push({ term: nameEn, label: '英文名', score: 90 });
  if (position.nameEn && position.nameEn !== nameEn && position.nameEn.length >= 4) {
    terms.push({ term: position.nameEn, label: '英文全称', score: 88 });
  }

  const tickerParts = (position.tickerBbg || '').split(/\s+/).filter(Boolean);
  if (position.tickerBbg.length >= 5) terms.push({ term: position.tickerBbg, label: 'ticker', score: 94 });
  if (tickerParts.length >= 2) {
    terms.push({ term: `${tickerParts[0]} ${tickerParts[1]}`, label: 'ticker', score: 86 });
    terms.push({ term: `${tickerParts[0]}.${tickerParts[1]}`, label: 'ticker', score: 86 });
  }
  if (tickerParts[0] && /^[a-z]{3,6}$/i.test(tickerParts[0])) {
    terms.push({ term: tickerParts[0], label: 'ticker code', score: 78 });
  }
  if (tickerParts[0] && /^\d{3,6}$/.test(tickerParts[0])) {
    terms.push({ term: `${tickerParts[0]} ${position.market || tickerParts[1] || ''}`, label: 'ticker code', score: 76 });
  }
  return terms;
}

function buildTaxonomyTerms(position: PositionRow) {
  const terms: string[] = [];
  addUnique(terms, position.sectorName);
  addUnique(terms, position.sectorRelationName);
  addUnique(terms, position.themeName);
  addUnique(terms, position.topdownName);
  addUnique(terms, position.gicIndustry);
  return terms.filter((term) => {
    const value = compact(term);
    if (/^[a-z0-9]+$/i.test(value)) return value.length >= 4;
    return value.length >= 2;
  });
}

const POSITIVE_KEYWORDS = [
  '利好', '超预期', '上调', '升级', '改善', '恢复', '回升', '增长', '加速', '扩张', '涨价', '提价', '中标',
  '订单增加', '份额提升', '利润率提升', '毛利率提升', '供给收缩', '运价上升', '需求强劲', 'strong demand',
  'beat', 'upgrade', 'outperform', 'raise guidance', 'margin expansion', 'price increase', 'supply tightness',
];

const NEGATIVE_KEYWORDS = [
  '利空', '低于预期', '下调', '降级', '恶化', '放缓', '下降', '下滑', '亏损', '降价', '延期', '取消', '诉讼',
  '监管', '制裁', '禁令', '关税', '成本上升', '毛利率压力', '利润率压力', '需求疲弱', '竞争加剧', '产能过剩',
  'miss', 'downgrade', 'weak demand', 'margin pressure', 'price cut', 'delay', 'ban', 'sanction', 'lawsuit',
];

function countKeywords(text: string, keywords: string[]) {
  let count = 0;
  for (const keyword of keywords) {
    const needle = normalize(keyword);
    if (!needle) continue;
    const matches = text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
    count += matches?.length || 0;
  }
  return count;
}

function inferFundamental(text: string) {
  const positive = countKeywords(text, POSITIVE_KEYWORDS);
  const negative = countKeywords(text, NEGATIVE_KEYWORDS);
  const diff = positive - negative;
  const mixed = positive > 0 && negative > 0 && Math.abs(diff) <= 1;
  if (diff === 0) return { score: 0, direction: directionFromScore(0, mixed), positive, negative };
  const magnitude = Math.min(3, Math.max(1, Math.ceil(Math.abs(diff) / 2)));
  const score = diff > 0 ? magnitude : -magnitude;
  return { score, direction: directionFromScore(score, mixed), positive, negative };
}

function inferChannel(text: string) {
  const checks: { channel: string; keywords: string[] }[] = [
    { channel: 'policy', keywords: ['政策', '监管', '关税', '制裁', '补贴', '审批', 'nrc', 'doe', 'tariff', 'regulation', 'sanction'] },
    { channel: 'margin', keywords: ['毛利率', '利润率', '成本', '涨价', '降价', 'margin', 'cost', 'price cut', 'price increase'] },
    { channel: 'revenue', keywords: ['收入', '订单', '销量', '需求', '交付', 'revenue', 'order', 'delivery', 'demand'] },
    { channel: 'competition', keywords: ['竞争', '份额', '竞品', '替代', 'competition', 'share gain', 'share loss'] },
    { channel: 'supply_chain', keywords: ['供应链', '库存', '产能', '供给', '短缺', 'supply chain', 'inventory', 'capacity'] },
    { channel: 'valuation', keywords: ['估值', 'pe', 'multiple', 'valuation', '目标价'] },
    { channel: 'liquidity', keywords: ['流动性', '融资', '利率', '信用', 'liquidity', 'funding', 'rates'] },
  ];
  for (const check of checks) {
    if (check.keywords.some((keyword) => normalize(text).includes(normalize(keyword)))) return check.channel;
  }
  return 'macro';
}

function inferHorizon(text: string) {
  const value = normalize(text);
  if (/(today|intraday|日内|当天|今日|明日|昨日)/i.test(value)) return '1d';
  if (/(this week|weekly|本周|下周|周度|一周)/i.test(value)) return '1w';
  if (/(quarter|季度|财季|q[1-4]|202[0-9]|guidance|指引)/i.test(value)) return '1q';
  if (/(long term|长期|3-5|五年|结构性)/i.test(value)) return 'long_term';
  return '1m';
}

function makeSnippet(text: string, terms: string[]) {
  const clean = stripHtml(text).slice(0, 8000);
  const lower = clean.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    const idx = lower.indexOf(needle);
    if (idx >= 0) {
      const start = Math.max(0, idx - 90);
      const end = Math.min(clean.length, idx + needle.length + 140);
      return `${start > 0 ? '...' : ''}${clean.slice(start, end)}${end < clean.length ? '...' : ''}`;
    }
  }
  return clean.slice(0, 260);
}

function analyzeFeedAgainstPosition(feed: FeedRow, position: PositionRow): ImpactCandidate | null {
  const tags = parseTags(feed.tags);
  const titleText = normalize(feed.title);
  const contentText = normalize(feed.content);
  const metadataText = normalize([feed.category, feed.source, tags.join(' ')].join(' '));
  const fullText = [titleText, metadataText, contentText].join(' ');
  const titleCompact = compact(feed.title);
  const metadataCompact = compact([feed.category, tags.join(' ')].join(' '));
  const fullCompact = compact([feed.title, feed.category, feed.source, tags.join(' '), feed.content].join(' '));

  const matchedTerms: string[] = [];
  let relevanceScore = 0;
  let directHit = false;

  for (const item of buildDirectTerms(position)) {
    const matchedInTitle = textIncludes(titleCompact, item.term);
    const matchedInFull = matchedInTitle || textIncludes(fullCompact, item.term);
    if (!matchedInFull) continue;
    directHit = true;
    matchedTerms.push(`${item.label}:${item.term}`);
    relevanceScore = Math.max(relevanceScore, matchedInTitle ? item.score : item.score - 8);
  }

  for (const term of buildTaxonomyTerms(position)) {
    if (textIncludes(metadataCompact, term) || textIncludes(titleCompact, term)) {
      matchedTerms.push(`分类:${term}`);
      relevanceScore = Math.max(relevanceScore, 70);
    } else if (textIncludes(fullCompact, term)) {
      matchedTerms.push(`分类:${term}`);
      relevanceScore = Math.max(relevanceScore, 46);
    }
  }

  if (relevanceScore < 42) return null;

  const fundamental = inferFundamental(fullText);
  const side = sideFromPosition(position);
  const sideSign = side === 'short' ? -1 : side === 'long' ? 1 : 0;
  const portfolioScore = round(fundamental.score * sideSign * Math.max(0.25, Math.abs(position.positionWeight || 0) * 20), 2);
  const confidence = round(clamp((relevanceScore / 100) * 0.58 + (Math.abs(fundamental.score) / 3) * 0.22 + (directHit ? 0.16 : 0.06), 0.35, 0.95), 2);
  const name = position.nameCn || position.nameEn || position.tickerBbg;
  const directionText = fundamental.direction === 'positive' ? '正面' : fundamental.direction === 'negative' ? '负面' : fundamental.direction === 'mixed' ? '多空混合' : '中性';
  const sideText = side === 'short' ? 'Short' : side === 'long' ? 'Long' : 'Watchlist';
  const thesis = `${name}: 信息与${matchedTerms.slice(0, 2).join('、')}相关，基本面判断为${directionText}；当前仓位为 ${sideText}。`;

  return {
    position,
    relevanceScore,
    fundamentalDirection: fundamental.direction,
    fundamentalScore: fundamental.score,
    portfolioDirection: directionFromScore(portfolioScore, fundamental.direction === 'mixed'),
    portfolioScore,
    horizon: inferHorizon(fullText),
    channel: inferChannel(fullText),
    confidence,
    thesis,
    evidence: {
      feedTitle: feed.title,
      feedSource: feed.source,
      feedCategory: feed.category,
      matchedTerms: Array.from(new Set(matchedTerms)).slice(0, 8),
      positiveKeywordCount: fundamental.positive,
      negativeKeywordCount: fundamental.negative,
      snippet: makeSnippet(feed.content || feed.title, matchedTerms.map((m) => m.split(':').slice(1).join(':'))),
      analyzer: DETERMINISTIC_ANALYZER,
    },
  };
}

function buildCandidatePairs(feeds: FeedRow[], positions: PositionRow[], maxPairs: number): CandidatePair[] {
  const pairs: CandidatePair[] = [];

  for (const feed of feeds) {
    const feedPairs = positions
      .map((position) => {
        const candidate = analyzeFeedAgainstPosition(feed, position);
        return candidate ? { feed, candidate } : null;
      })
      .filter((item): item is { feed: FeedRow; candidate: ImpactCandidate } => Boolean(item))
      .sort((a, b) => {
        const aTerms = (a.candidate.evidence.matchedTerms as string[] | undefined) || [];
        const bTerms = (b.candidate.evidence.matchedTerms as string[] | undefined) || [];
        const aDirect = aTerms.some((term) => !term.startsWith('分类:')) ? 1 : 0;
        const bDirect = bTerms.some((term) => !term.startsWith('分类:')) ? 1 : 0;
        if (aDirect !== bDirect) return bDirect - aDirect;
        if (a.candidate.relevanceScore !== b.candidate.relevanceScore) return b.candidate.relevanceScore - a.candidate.relevanceScore;
        return Math.abs(b.candidate.position.positionAmount || 0) - Math.abs(a.candidate.position.positionAmount || 0);
      })
      .slice(0, 18);

    for (const pair of feedPairs) {
      pairs.push({ id: `i${pairs.length + 1}`, ...pair });
      if (pairs.length >= maxPairs) return pairs;
    }
  }

  return pairs;
}

function serializeCandidatePairs(pairs: CandidatePair[]) {
  return pairs.map((pair) => {
    const { feed, candidate } = pair;
    const position = candidate.position;
    const matchedTerms = (candidate.evidence.matchedTerms as string[] | undefined) || [];
    return {
      itemId: pair.id,
      feed: {
        id: feed.id,
        title: feed.title,
        type: feed.type,
        category: feed.category,
        source: feed.source,
        publishedAt: feed.publishedAt,
        tags: parseTags(feed.tags),
        excerpt: truncate(feed.content || feed.title, 2400),
      },
      position: {
        id: position.id,
        tickerBbg: position.tickerBbg,
        nameEn: position.nameEn,
        nameCn: position.nameCn,
        market: position.market,
        side: sideFromPosition(position),
        rawLongShort: position.longShort,
        positionWeight: position.positionWeight,
        positionAmount: position.positionAmount,
        sectorName: position.sectorName,
        taxonomy: [position.sectorRelationName, position.themeName, position.topdownName, position.gicIndustry].filter(Boolean),
      },
      retrievalHint: {
        relevanceScore: candidate.relevanceScore,
        matchedTerms,
        keywordDirection: candidate.fundamentalDirection,
        keywordScore: candidate.fundamentalScore,
      },
    };
  });
}

function buildAgentInstruction(items: ReturnType<typeof serializeCandidatePairs>, staleFeedItemIds: string[]) {
  return `你是 Codex direct portfolio impact analyst。请逐条判断每个 feed-position pair 是否真的构成对持仓的基本面影响。

不要因为分类相同就判定有影响；必须写清楚信息到公司/ETF的经济传导机制。若只是泛行业描述、弱相关、没有收入/利润率/成本/政策/供需/估值/竞争传导，返回 hasImpact=false。

完成后调用 MCP 工具 portfolio_impact_agent_apply，提交 JSON：
{
  "staleFeedItemIds": ${JSON.stringify(staleFeedItemIds)},
  "results": [
    {
      "itemId": "i1",
      "feedItemId": "...",
      "positionId": 123,
      "hasImpact": true,
      "relevanceScore": 85,
      "fundamentalDirection": "positive|negative|neutral|mixed",
      "fundamentalScore": -3,
      "confidence": 0.8,
      "horizon": "1d|1w|1m|1q|long_term",
      "channel": "revenue|margin|valuation|policy|competition|supply_chain|macro|liquidity",
      "thesis": "中文一句话",
      "evidenceSnippet": "关键证据片段",
      "reasoning": "2-3句，解释传导链条和为什么不是只靠分类匹配"
    }
  ]
}

待判断数据：
${JSON.stringify({ items }, null, 2)}`;
}

function buildLlmPrompt(pairs: CandidatePair[]) {
  const items = serializeCandidatePairs(pairs);
  return `你是买方投资组合的信息流影响分析员。请判断每个 feed-position pair 是否真的构成对该持仓的可交易/可跟踪影响。

核心要求：
1. 不要因为同属一个大行业就判定有影响。只有当信息明确影响该公司/ETF/行业链条的收入、利润率、成本、监管、供需、估值或竞争格局，才算 hasImpact=true。
2. 若只是“分类相同”“标题泛泛提到汽车/石油/AI/政策”，但没有清晰经济传导机制，必须 hasImpact=false。
3. 对单家公司，必须说明从信息到该公司的传导链条。对 ETF，可以基于其行业暴露判断，但也要写明原因。
4. fundamentalDirection 是对标的基本面的影响，不是对当前仓位的 P&L 影响。portfolioDirection 由系统后续根据仓位方向计算。
5. 输出必须是 JSON，不要 Markdown。

方向定义：
- positive: 对标的基本面正面
- negative: 对标的基本面负面
- mixed: 多空都有且无法净额判断
- neutral: 有相关性但方向很弱；若没有实质相关性请 hasImpact=false

返回 schema:
{
  "items": [
    {
      "itemId": "i1",
      "hasImpact": true,
      "relevanceScore": 0-100,
      "fundamentalDirection": "positive|negative|neutral|mixed",
      "fundamentalScore": -3 到 3,
      "confidence": 0 到 1,
      "horizon": "1d|1w|1m|1q|long_term",
      "channel": "revenue|margin|valuation|policy|competition|supply_chain|macro|liquidity",
      "thesis": "中文一句话，说明信息如何影响该标的基本面",
      "evidenceSnippet": "原文中最关键的一小段证据",
      "reasoning": "中文，2-3句，必须说明不是只靠分类匹配"
    }
  ]
}

如果 hasImpact=false，仍返回 itemId 和 hasImpact=false，可省略其他字段。

待判断数据：
${JSON.stringify({ items }, null, 2)}`;
}

function extractJsonText(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

async function callGeminiImpactBatch(pairs: CandidatePair[], model: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY 未配置，无法运行 LLM impact analyzer');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: buildLlmPrompt(pairs) }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || response.statusText;
    throw new Error(`Gemini impact analyzer failed (${response.status}): ${message}`);
  }

  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map((part: any) => part?.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini impact analyzer returned empty response');

  try {
    const parsed = JSON.parse(extractJsonText(text));
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch (error: any) {
    throw new Error(`Gemini impact analyzer returned invalid JSON: ${error.message}`);
  }
}

function candidateFromLlmDecision(pair: CandidatePair, decision: any, model: string): ImpactCandidate | null {
  if (!decision || decision.hasImpact === false) return null;
  const position = pair.candidate.position;
  const fallbackText = `${pair.feed.title} ${pair.feed.category} ${pair.feed.content}`;
  const direction = normalizeDirection(decision.fundamentalDirection, pair.candidate.fundamentalDirection);
  const scoreRaw = Number(decision.fundamentalScore);
  const score = clamp(Number.isFinite(scoreRaw) ? scoreRaw : pair.candidate.fundamentalScore, -3, 3);
  const confidenceRaw = Number(decision.confidence);
  const confidence = round(clamp(Number.isFinite(confidenceRaw) ? confidenceRaw : 0.45, 0, 1), 2);

  if (confidence < 0.35) return null;
  if (direction === 'neutral' && Math.abs(score) < 0.75) return null;

  const side = sideFromPosition(position);
  const sideSign = side === 'short' ? -1 : side === 'long' ? 1 : 0;
  const portfolioScore = round(score * sideSign * Math.max(0.25, Math.abs(position.positionWeight || 0) * 20), 2);
  const relevanceRaw = Number(decision.relevanceScore);
  const relevanceScore = round(clamp(Number.isFinite(relevanceRaw) ? relevanceRaw : pair.candidate.relevanceScore, 0, 100), 1);
  const thesis = String(decision.thesis || pair.candidate.thesis).trim().slice(0, 500);
  const evidenceSnippet = String(decision.evidenceSnippet || pair.candidate.evidence.snippet || '').trim().slice(0, 900);
  const reasoning = String(decision.reasoning || '').trim().slice(0, 900);

  return {
    position,
    relevanceScore,
    fundamentalDirection: direction,
    fundamentalScore: round(score, 1),
    portfolioDirection: directionFromScore(portfolioScore, direction === 'mixed'),
    portfolioScore,
    horizon: normalizeHorizon(decision.horizon, inferHorizon(fallbackText)),
    channel: normalizeChannel(decision.channel, inferChannel(fallbackText)),
    confidence,
    thesis,
    evidence: {
      ...pair.candidate.evidence,
      analyzer: LLM_ANALYZER,
      model,
      llmReasoning: reasoning,
      snippet: evidenceSnippet || pair.candidate.evidence.snippet,
      retrievalAnalyzer: DETERMINISTIC_ANALYZER,
      retrievalKeywordDirection: pair.candidate.fundamentalDirection,
      retrievalKeywordScore: pair.candidate.fundamentalScore,
    },
  };
}

function candidateFromAgentResult(feed: FeedRow, position: PositionRow, result: any): ImpactCandidate | null {
  if (!result || result.hasImpact === false) return null;
  const fallbackText = `${feed.title} ${feed.category} ${feed.content}`;
  const direction = normalizeDirection(result.fundamentalDirection);
  const scoreRaw = Number(result.fundamentalScore);
  const score = clamp(Number.isFinite(scoreRaw) ? scoreRaw : 0, -3, 3);
  const confidenceRaw = Number(result.confidence);
  const confidence = round(clamp(Number.isFinite(confidenceRaw) ? confidenceRaw : 0.55, 0, 1), 2);
  if (confidence < 0.25) return null;
  if (direction === 'neutral' && Math.abs(score) < 0.5) return null;

  const side = sideFromPosition(position);
  const sideSign = side === 'short' ? -1 : side === 'long' ? 1 : 0;
  const portfolioScore = round(score * sideSign * Math.max(0.25, Math.abs(position.positionWeight || 0) * 20), 2);
  const relevanceRaw = Number(result.relevanceScore);
  const relevanceScore = round(clamp(Number.isFinite(relevanceRaw) ? relevanceRaw : confidence * 100, 0, 100), 1);
  const thesis = String(result.thesis || '').trim().slice(0, 500);
  const evidenceSnippet = String(result.evidenceSnippet || '').trim().slice(0, 900);
  const reasoning = String(result.reasoning || '').trim().slice(0, 1200);

  return {
    position,
    relevanceScore,
    fundamentalDirection: direction,
    fundamentalScore: round(score, 1),
    portfolioDirection: directionFromScore(portfolioScore, direction === 'mixed'),
    portfolioScore,
    horizon: normalizeHorizon(result.horizon, inferHorizon(fallbackText)),
    channel: normalizeChannel(result.channel, inferChannel(fallbackText)),
    confidence,
    thesis: thesis || `${position.nameCn || position.nameEn || position.tickerBbg}: Codex direct analysis marked this feed as material.`,
    evidence: {
      feedTitle: feed.title,
      feedSource: feed.source,
      feedCategory: feed.category,
      analyzer: DIRECT_AGENT_ANALYZER,
      itemId: result.itemId || '',
      llmReasoning: reasoning,
      snippet: evidenceSnippet || makeSnippet(feed.content || feed.title, []),
    },
  };
}

function buildAlert(candidate: ImpactCandidate): AlertCandidate | null {
  const position = candidate.position;
  const side = sideFromPosition(position);
  const weight = Math.abs(position.positionWeight || 0);
  const score = candidate.fundamentalScore;
  const confidence = candidate.confidence;
  const name = position.nameCn || position.nameEn || position.tickerBbg;

  const highSeverity = weight >= 0.05 && confidence >= 0.7;
  if (side === 'long' && score <= -2 && confidence >= 0.55) {
    return {
      severity: highSeverity || Math.abs(score) >= 3 ? 'critical' : 'warning',
      alertType: 'long_negative',
      message: `你当前是 Long ${name}，但新增信息对基本面判断为负面，方向与仓位不一致。`,
    };
  }
  if (side === 'short' && score >= 2 && confidence >= 0.55) {
    return {
      severity: highSeverity || Math.abs(score) >= 3 ? 'critical' : 'warning',
      alertType: 'short_positive',
      message: `你当前是 Short ${name}，但新增信息对基本面判断为正面，方向与仓位不一致。`,
    };
  }
  if (side === 'watchlist' && Math.abs(score) >= 2 && confidence >= 0.6) {
    return {
      severity: 'watch',
      alertType: 'watchlist_high_signal',
      message: `${name} 处于观察列表，但新增信息强度较高，建议决定是否纳入跟踪。`,
    };
  }
  if (candidate.fundamentalDirection === 'mixed' && weight >= 0.05 && confidence >= 0.5) {
    return {
      severity: 'watch',
      alertType: 'large_position_uncertain',
      message: `${name} 仓位较大，但新增信息多空混合，建议人工确认。`,
    };
  }
  return null;
}

async function loadPositions(userId: string): Promise<PositionRow[]> {
  return prisma.$queryRaw<PositionRow[]>`
    SELECT
      p."id",
      p."tickerBbg",
      p."nameEn",
      p."nameCn",
      p."market",
      p."priority",
      p."longShort",
      p."positionAmount",
      p."positionWeight",
      p."sectorName",
      COALESCE(s."name", '') AS "sectorRelationName",
      COALESCE(t."name", '') AS "themeName",
      COALESCE(td."name", '') AS "topdownName",
      p."gicIndustry",
      p."exchangeCountry"
    FROM "PortfolioPosition" p
    LEFT JOIN "PortfolioTaxonomy" s ON s."id" = p."sectorId"
    LEFT JOIN "PortfolioTaxonomy" t ON t."id" = p."themeId"
    LEFT JOIN "PortfolioTaxonomy" td ON td."id" = p."topdownId"
    WHERE p."userId" = ${userId}
    ORDER BY ABS(p."positionAmount") DESC
  `;
}

async function loadFeeds(userId: string, options: { feedItemId?: string; since: Date; limit: number }): Promise<FeedRow[]> {
  if (options.feedItemId) {
    return prisma.$queryRaw<FeedRow[]>`
      SELECT "id", "type", "category", "title", "content", "contentFormat", "source", "tags", "publishedAt", "updatedAt"
      FROM "FeedItem"
      WHERE "userId" = ${userId} AND "id" = ${options.feedItemId}
      LIMIT 1
    `;
  }

  return prisma.$queryRaw<FeedRow[]>`
    SELECT "id", "type", "category", "title", "content", "contentFormat", "source", "tags", "publishedAt", "updatedAt"
    FROM "FeedItem"
    WHERE "userId" = ${userId} AND "publishedAt" >= ${options.since}
    ORDER BY "publishedAt" DESC
    LIMIT ${options.limit}
  `;
}

async function loadFeedsByIds(userId: string, ids: string[]): Promise<FeedRow[]> {
  if (!ids.length) return [];
  return prisma.$queryRaw<FeedRow[]>`
    SELECT "id", "type", "category", "title", "content", "contentFormat", "source", "tags", "publishedAt", "updatedAt"
    FROM "FeedItem"
    WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])
  `;
}

async function markFeedsStale(userId: string, feeds: FeedRow[]) {
  for (const feed of feeds) {
    await prisma.$executeRaw`
      UPDATE "PortfolioImpactAlert" a
      SET "status" = 'resolved', "updatedAt" = CURRENT_TIMESTAMP
      FROM "PortfolioFeedImpact" i
      WHERE a."impactId" = i."id"
        AND i."userId" = ${userId}
        AND i."feedItemId" = ${feed.id}
        AND i."status" NOT IN ('confirmed', 'dismissed')
        AND a."status" = 'open'
    `;
    await prisma.$executeRaw`
      UPDATE "PortfolioFeedImpact"
      SET "status" = 'stale', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = ${userId}
        AND "feedItemId" = ${feed.id}
        AND "status" NOT IN ('confirmed', 'dismissed')
    `;
  }
}

async function upsertImpact(userId: string, feed: FeedRow, candidate: ImpactCandidate) {
  const impactId = randomUUID();
  const evidenceJson = JSON.stringify(candidate.evidence);
  const rows = await prisma.$queryRaw<{ id: string; status: string }[]>`
    INSERT INTO "PortfolioFeedImpact" (
      "id", "userId", "feedItemId", "positionId", "relevanceScore",
      "fundamentalDirection", "fundamentalScore", "portfolioDirection", "portfolioScore",
      "horizon", "channel", "confidence", "thesis", "evidenceJson", "status",
      "createdAt", "updatedAt"
    )
    VALUES (
      ${impactId}, ${userId}, ${feed.id}, ${candidate.position.id}, ${candidate.relevanceScore},
      ${candidate.fundamentalDirection}, ${candidate.fundamentalScore}, ${candidate.portfolioDirection}, ${candidate.portfolioScore},
      ${candidate.horizon}, ${candidate.channel}, ${candidate.confidence}, ${candidate.thesis}, ${evidenceJson}, 'new',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("feedItemId", "positionId") DO UPDATE SET
      "relevanceScore" = EXCLUDED."relevanceScore",
      "fundamentalDirection" = EXCLUDED."fundamentalDirection",
      "fundamentalScore" = EXCLUDED."fundamentalScore",
      "portfolioDirection" = EXCLUDED."portfolioDirection",
      "portfolioScore" = EXCLUDED."portfolioScore",
      "horizon" = EXCLUDED."horizon",
      "channel" = EXCLUDED."channel",
      "confidence" = EXCLUDED."confidence",
      "thesis" = EXCLUDED."thesis",
      "evidenceJson" = EXCLUDED."evidenceJson",
      "status" = CASE
        WHEN "PortfolioFeedImpact"."status" = 'confirmed' THEN 'confirmed'
        WHEN "PortfolioFeedImpact"."status" = 'dismissed' THEN 'dismissed'
        ELSE 'new'
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id", "status"
  `;
  return rows[0];
}

async function upsertAlert(userId: string, impactId: string, positionId: number, alert: AlertCandidate | null) {
  if (!alert) {
    await prisma.$executeRaw`
      UPDATE "PortfolioImpactAlert"
      SET "status" = 'resolved', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "impactId" = ${impactId} AND "status" = 'open'
    `;
    return false;
  }

  const alertId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "PortfolioImpactAlert" (
      "id", "userId", "impactId", "positionId", "severity", "alertType", "message", "status", "createdAt", "updatedAt"
    )
    VALUES (
      ${alertId}, ${userId}, ${impactId}, ${positionId}, ${alert.severity}, ${alert.alertType}, ${alert.message}, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("impactId", "alertType") DO UPDATE SET
      "severity" = EXCLUDED."severity",
      "message" = EXCLUDED."message",
      "status" = CASE
        WHEN "PortfolioImpactAlert"."status" IN ('dismissed', 'resolved') THEN "PortfolioImpactAlert"."status"
        ELSE 'open'
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
  return true;
}

function buildSummary(impacts: any[]) {
  const openAlerts = impacts.flatMap((impact) => Array.isArray(impact.alerts) ? impact.alerts.filter((alert: any) => alert.status === 'open') : []);
  const positionIds = new Set(impacts.map((impact) => impact.positionId));
  return {
    netPortfolioScore: round(impacts.reduce((sum, impact) => sum + Number(impact.portfolioScore || 0), 0), 2),
    alertCount: openAlerts.length,
    criticalCount: openAlerts.filter((alert: any) => alert.severity === 'critical').length,
    warningCount: openAlerts.filter((alert: any) => alert.severity === 'warning').length,
    impactedPositions: positionIds.size,
    unreviewed: impacts.filter((impact) => impact.status === 'new').length,
    positiveCount: impacts.filter((impact) => impact.portfolioDirection === 'positive').length,
    negativeCount: impacts.filter((impact) => impact.portfolioDirection === 'negative').length,
  };
}

export async function runImpactAnalysis(req: Request, res: Response) {
  await ensureImpactSchema();
  const userId = req.userId!;
  const { feedItemId, since, days = 1, limit = 100, analyzer, model, maxPairs } = req.body || {};
  const sinceDate = since ? new Date(since) : new Date(Date.now() - Number(days || 1) * 24 * 60 * 60 * 1000);
  const take = clamp(Number(limit) || 100, 1, 300);
  const selectedAnalyzer: ImpactAnalyzer = analyzer === DETERMINISTIC_ANALYZER ? DETERMINISTIC_ANALYZER : LLM_ANALYZER;
  const selectedModel = String(model || DEFAULT_LLM_MODEL);

  const [positions, feeds] = await Promise.all([
    loadPositions(userId),
    loadFeeds(userId, { feedItemId, since: sinceDate, limit: take }),
  ]);

  let impactCount = 0;
  let alertCount = 0;
  const touchedImpactIds: string[] = [];
  let candidateCount = 0;

  if (selectedAnalyzer === LLM_ANALYZER) {
    const pairs = buildCandidatePairs(feeds, positions, clamp(Number(maxPairs) || 120, 1, 240));
    candidateCount = pairs.length;
    const pairById = new Map(pairs.map((pair) => [pair.id, pair]));
    const batchSize = 6;
    const acceptedCandidates: { feed: FeedRow; candidate: ImpactCandidate }[] = [];

    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      const decisions = await callGeminiImpactBatch(batch, selectedModel);

      for (const decision of decisions) {
        const pair = pairById.get(String(decision?.itemId || ''));
        if (!pair) continue;
        const candidate = candidateFromLlmDecision(pair, decision, selectedModel);
        if (candidate) acceptedCandidates.push({ feed: pair.feed, candidate });
      }
    }

    await markFeedsStale(userId, feeds);

    for (const { feed, candidate } of acceptedCandidates) {
      const impact = await upsertImpact(userId, feed, candidate);
      touchedImpactIds.push(impact.id);
      impactCount += 1;
      const alert = buildAlert(candidate);
      const createdAlert = await upsertAlert(userId, impact.id, candidate.position.id, alert);
      if (createdAlert) alertCount += 1;
    }

    return res.json({
      success: true,
      data: {
        processedFeedCount: feeds.length,
        positionCount: positions.length,
        candidateCount,
        impactCount,
        alertCount,
        touchedImpactIds,
        analyzer: LLM_ANALYZER,
        model: selectedModel,
      },
    });
  }

  for (const feed of feeds) {
    for (const position of positions) {
      const candidate = analyzeFeedAgainstPosition(feed, position);
      if (!candidate) continue;
      const impact = await upsertImpact(userId, feed, candidate);
      touchedImpactIds.push(impact.id);
      impactCount += 1;
      const alert = buildAlert(candidate);
      const createdAlert = await upsertAlert(userId, impact.id, position.id, alert);
      if (createdAlert) alertCount += 1;
    }
  }

  return res.json({
    success: true,
    data: {
      processedFeedCount: feeds.length,
      positionCount: positions.length,
      candidateCount,
      impactCount,
      alertCount,
      touchedImpactIds,
      analyzer: DETERMINISTIC_ANALYZER,
    },
  });
}

export async function getAgentImpactContext(req: Request, res: Response) {
  await ensureImpactSchema();
  const userId = req.userId!;
  const { feedItemId, since, days = 1, limit = 100, maxPairs = 120 } = req.body || {};
  const sinceDate = since ? new Date(since) : new Date(Date.now() - Number(days || 1) * 24 * 60 * 60 * 1000);
  const take = clamp(Number(limit) || 100, 1, 300);

  const [positions, feeds] = await Promise.all([
    loadPositions(userId),
    loadFeeds(userId, { feedItemId, since: sinceDate, limit: take }),
  ]);
  const pairs = buildCandidatePairs(feeds, positions, clamp(Number(maxPairs) || 120, 1, 240));
  const items = serializeCandidatePairs(pairs);
  const staleFeedItemIds = Array.from(new Set(feeds.map((feed) => feed.id)));

  return res.json({
    success: true,
    data: {
      analyzer: DIRECT_AGENT_ANALYZER,
      generatedAt: new Date().toISOString(),
      processedFeedCount: feeds.length,
      positionCount: positions.length,
      candidateCount: items.length,
      staleFeedItemIds,
      applyEndpoint: '/api/portfolio/impacts/agent-apply',
      instructions: buildAgentInstruction(items, staleFeedItemIds),
      items,
    },
  });
}

export async function applyAgentImpactAnalysis(req: Request, res: Response) {
  await ensureImpactSchema();
  const userId = req.userId!;
  const results = Array.isArray(req.body?.results) ? req.body.results : [];
  if (!results.length) {
    return res.status(400).json({ success: false, error: 'results[] is required' });
  }

  const staleFeedItemIds = Array.isArray(req.body?.staleFeedItemIds)
    ? req.body.staleFeedItemIds.map(String).filter(Boolean)
    : [];
  const resultFeedItemIds = results.map((item: any) => String(item.feedItemId || '')).filter(Boolean);
  const feedIds = Array.from(new Set([...staleFeedItemIds, ...resultFeedItemIds]));
  const [positions, feeds] = await Promise.all([
    loadPositions(userId),
    loadFeedsByIds(userId, feedIds),
  ]);
  const positionById = new Map(positions.map((position) => [position.id, position]));
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));

  await markFeedsStale(userId, feeds);

  let impactCount = 0;
  let alertCount = 0;
  const touchedImpactIds: string[] = [];
  const skipped: { itemId?: string; reason: string }[] = [];

  for (const result of results) {
    if (result?.hasImpact === false) continue;
    const feed = feedById.get(String(result.feedItemId || ''));
    const positionId = Number(result.positionId);
    const position = positionById.get(positionId);
    if (!feed || !position) {
      skipped.push({ itemId: result?.itemId, reason: 'feed or position not found' });
      continue;
    }
    const candidate = candidateFromAgentResult(feed, position, result);
    if (!candidate) {
      skipped.push({ itemId: result?.itemId, reason: 'invalid or low confidence result' });
      continue;
    }
    const impact = await upsertImpact(userId, feed, candidate);
    touchedImpactIds.push(impact.id);
    impactCount += 1;
    const alert = buildAlert(candidate);
    const createdAlert = await upsertAlert(userId, impact.id, position.id, alert);
    if (createdAlert) alertCount += 1;
  }

  return res.json({
    success: true,
    data: {
      analyzer: DIRECT_AGENT_ANALYZER,
      processedResultCount: results.length,
      impactCount,
      alertCount,
      touchedImpactIds,
      skipped,
    },
  });
}

export async function listImpacts(req: Request, res: Response) {
  await ensureImpactSchema();
  const userId = req.userId!;
  const {
    days = '7',
    positionId,
    feedItemId,
    onlyAlerts,
    status,
    limit = '200',
  } = req.query as Record<string, string>;
  const sinceDate = new Date(Date.now() - Number(days || 7) * 24 * 60 * 60 * 1000);
  const take = clamp(Number(limit) || 200, 1, 500);

  const rows = await prisma.$queryRaw<any[]>`
    SELECT
      i.*,
      json_build_object(
        'id', p."id",
        'tickerBbg', p."tickerBbg",
        'nameCn', p."nameCn",
        'nameEn', p."nameEn",
        'longShort', p."longShort",
        'positionWeight', p."positionWeight",
        'positionAmount', p."positionAmount",
        'sectorName', p."sectorName"
      ) AS "position",
      json_build_object(
        'id', f."id",
        'title', f."title",
        'type', f."type",
        'category', f."category",
        'source', f."source",
        'publishedAt', f."publishedAt"
      ) AS "feedItem",
      COALESCE(
        json_agg(
          json_build_object(
            'id', a."id",
            'severity', a."severity",
            'alertType', a."alertType",
            'message', a."message",
            'status', a."status",
            'createdAt', a."createdAt",
            'updatedAt', a."updatedAt"
          )
        ) FILTER (WHERE a."id" IS NOT NULL),
        '[]'::json
      ) AS "alerts"
    FROM "PortfolioFeedImpact" i
    JOIN "PortfolioPosition" p ON p."id" = i."positionId"
    JOIN "FeedItem" f ON f."id" = i."feedItemId"
    LEFT JOIN "PortfolioImpactAlert" a ON a."impactId" = i."id"
    WHERE i."userId" = ${userId}
      AND f."publishedAt" >= ${sinceDate}
      AND (${positionId ? Number(positionId) : null}::integer IS NULL OR i."positionId" = ${positionId ? Number(positionId) : null}::integer)
      AND (${feedItemId || null}::text IS NULL OR i."feedItemId" = ${feedItemId || null}::text)
      AND (${status || null}::text IS NULL OR i."status" = ${status || null}::text)
      AND (${status || null}::text IS NOT NULL OR i."status" NOT IN ('dismissed', 'stale'))
    GROUP BY i."id", p."id", f."id"
    HAVING (${onlyAlerts === 'true' ? true : null}::boolean IS NULL OR COUNT(a."id") FILTER (WHERE a."status" = 'open') > 0)
    ORDER BY
      COUNT(a."id") FILTER (WHERE a."severity" = 'critical' AND a."status" = 'open') DESC,
      ABS(i."portfolioScore") DESC,
      i."createdAt" DESC
    LIMIT ${take}
  `;

  const impacts = rows.map((row) => ({
    ...row,
    evidence: (() => {
      try { return JSON.parse(row.evidenceJson || '{}'); } catch { return {}; }
    })(),
  }));

  return res.json({ success: true, data: { impacts, summary: buildSummary(impacts) } });
}

export async function updateImpact(req: Request, res: Response) {
  await ensureImpactSchema();
  const userId = req.userId!;
  const { id } = req.params;
  const status = ['new', 'confirmed', 'dismissed', 'stale'].includes(req.body?.status) ? req.body.status : undefined;
  if (!status) return res.status(400).json({ success: false, error: 'Invalid status' });

  const rows = await prisma.$queryRaw<any[]>`
    UPDATE "PortfolioFeedImpact"
    SET "status" = ${status}, "reviewedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id} AND "userId" = ${userId}
    RETURNING *
  `;
  if (!rows[0]) return res.status(404).json({ success: false, error: 'Impact not found' });
  return res.json({ success: true, data: rows[0] });
}

export async function updateAlert(req: Request, res: Response) {
  await ensureImpactSchema();
  const userId = req.userId!;
  const { id } = req.params;
  const status = ['open', 'acknowledged', 'dismissed', 'resolved'].includes(req.body?.status) ? req.body.status : undefined;
  if (!status) return res.status(400).json({ success: false, error: 'Invalid status' });

  const rows = await prisma.$queryRaw<any[]>`
    UPDATE "PortfolioImpactAlert"
    SET "status" = ${status}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id} AND "userId" = ${userId}
    RETURNING *
  `;
  if (!rows[0]) return res.status(404).json({ success: false, error: 'Alert not found' });
  return res.json({ success: true, data: rows[0] });
}
