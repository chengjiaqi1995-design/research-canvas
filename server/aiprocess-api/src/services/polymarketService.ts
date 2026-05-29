import prisma from '../utils/db';

const GAMMA_BASE_URL = process.env.POLYMARKET_GAMMA_BASE_URL || 'https://gamma-api.polymarket.com';
const POLYMARKET_BASE_URL = 'https://polymarket.com/event';

interface PortfolioPositionForPolymarket {
  id: number;
  tickerBbg: string;
  nameEn: string;
  nameCn: string;
  longShort: string;
  positionAmount: number;
  positionWeight: number;
  sectorName: string;
  gicIndustry: string;
  exchangeCountry: string;
  sector?: { name: string } | null;
  theme?: { name: string } | null;
  topdown?: { name: string } | null;
}

interface GammaTag {
  id?: string | number;
  slug?: string;
  label?: string;
  name?: string;
}

interface GammaMarket {
  id?: string;
  question?: string;
  slug?: string;
  outcomePrices?: string | number[];
  outcomes?: string | string[];
  volume?: string | number;
  liquidity?: string | number;
  volumeNum?: number;
  liquidityNum?: number;
}

interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  description?: string;
  endDate?: string;
  startDate?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: string | number;
  liquidity?: string | number;
  volume24hr?: string | number;
  volume1wk?: string | number;
  tags?: GammaTag[];
  markets?: GammaMarket[];
}

export interface PolymarketMatchedPosition {
  id: number;
  tickerBbg: string;
  name: string;
  side: string;
  weight: number;
  reason: string;
}

export interface PolymarketMatchedMarket {
  eventId: string;
  title: string;
  slug: string;
  url: string;
  description: string;
  endDate?: string;
  volume: number;
  liquidity: number;
  volume24hr: number;
  volume1wk: number;
  yesProbability: number | null;
  probabilityLabel: string;
  matchedQueries: string[];
  matchedPositions: PolymarketMatchedPosition[];
  tags: string[];
}

interface SyncOptions {
  maxPositions?: number;
  maxQueries?: number;
  maxMarkets?: number;
  minVolume?: number;
  dryRun?: boolean;
}

const STATIC_QUERIES = [
  'bitcoin',
  'MicroStrategy bitcoin',
  'WTI crude oil',
  'crude oil',
  'LNG natural gas',
  'Fed rates',
  'inflation',
  'tariffs',
  'AI data center',
  'NVIDIA Data Center Revenue',
  'solar',
  'China India military clash',
  'India election',
  'France Macron',
  'Ukraine Russia',
];

const EXPOSURE_QUERY_RULES: { pattern: RegExp; queries: string[]; reason: string }[] = [
  { pattern: /bitcoin|crypto|miner|riot|比特币|矿机|矿工/i, queries: ['bitcoin', 'MicroStrategy bitcoin'], reason: 'crypto/bitcoin exposure' },
  { pattern: /oil|petro|energy|gas|lng|xle|crude|石油|油气|天然气|原油/i, queries: ['WTI crude oil', 'crude oil', 'LNG natural gas'], reason: 'oil/gas exposure' },
  { pattern: /solar|renewable|green|tan|太阳能|光伏|绿电|新能源/i, queries: ['solar', 'tariffs', 'AI data center'], reason: 'solar/green power exposure' },
  { pattern: /data center|datacenter|ai|power|electric|grid|turbine|nuclear|cooling|pump|数据中心|算力|电力|电网|燃机|核电|冷却|泵/i, queries: ['AI data center', 'NVIDIA Data Center Revenue', 'Fed rates'], reason: 'AI power/data-center exposure' },
  { pattern: /auto|vehicle|ev|car|bmw|mercedes|ford|nio|maruti|renault|汽车|整车|电动车/i, queries: ['tariffs', 'Tesla earnings'], reason: 'auto/tariff/EV exposure' },
  { pattern: /currency|curncy|cnh|inr|china|india|货币|人民币|印度|中国/i, queries: ['China India military clash', 'India election', 'Fed rates'], reason: 'FX/geopolitical exposure' },
  { pattern: /france|europe|germany|gr equity|fp equity|法国|欧洲|德国/i, queries: ['France Macron', 'Fed rates', 'inflation'], reason: 'Europe macro/political exposure' },
];

const BLOCKED_TAGS = new Set(['sports', 'esports', 'games', 'league-of-legends', 'soccer', 'basketball', 'baseball']);

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function cleanText(value: string): string {
  return (value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tickerCode(tickerBbg: string): string {
  return (tickerBbg || '').split(/\s+/)[0] || '';
}

function cleanCompanyName(name: string): string {
  return cleanText(name)
    .replace(/\b(ORD|EQUITY|INC|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|PLC|CLASS|CL A|ADR|ADS)\b/gi, ' ')
    .replace(/\s+[A-Z]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return cleanText(value).toLowerCase();
}

function addUnique(values: string[], value?: string | null) {
  const cleaned = cleanText(value || '');
  if (!cleaned) return;
  if (!values.some((item) => item.toLowerCase() === cleaned.toLowerCase())) values.push(cleaned);
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function yesProbability(event: GammaEvent): number | null {
  const market = event.markets?.[0];
  if (!market?.outcomePrices) return null;
  const prices = parseJsonArray<number | string>(market.outcomePrices);
  if (!prices.length) return null;
  const yes = toNumber(prices[0]);
  if (!Number.isFinite(yes) || yes <= 0) return null;
  return Math.round(yes * 1000) / 10;
}

function tagSlugs(event: GammaEvent): string[] {
  return (event.tags || [])
    .map((tag) => cleanText(tag.slug || tag.label || tag.name || ''))
    .filter(Boolean);
}

function isBlockedEvent(event: GammaEvent): boolean {
  const tags = tagSlugs(event).map((tag) => tag.toLowerCase());
  return tags.some((tag) => BLOCKED_TAGS.has(tag));
}

function positionSearchText(position: PortfolioPositionForPolymarket): string {
  return [
    position.tickerBbg,
    tickerCode(position.tickerBbg),
    position.nameEn,
    position.nameCn,
    position.sectorName,
    position.gicIndustry,
    position.exchangeCountry,
    position.sector?.name,
    position.theme?.name,
    position.topdown?.name,
  ].filter(Boolean).join(' ');
}

function buildPositionQueries(position: PortfolioPositionForPolymarket): string[] {
  const queries: string[] = [];
  const code = tickerCode(position.tickerBbg);
  if (/^[A-Z]{2,6}$/i.test(code) && !['CNH', 'INR'].includes(code.toUpperCase())) addUnique(queries, code);

  const name = cleanCompanyName(position.nameEn || position.nameCn);
  if (name.length >= 4) {
    addUnique(queries, name);
    const head = name.split(/\s+/).slice(0, 3).join(' ');
    if (head.length >= 4) addUnique(queries, head);
  }

  const exposureText = positionSearchText(position);
  for (const rule of EXPOSURE_QUERY_RULES) {
    if (rule.pattern.test(exposureText)) {
      for (const query of rule.queries) addUnique(queries, query);
    }
  }

  return queries;
}

function buildQueries(positions: PortfolioPositionForPolymarket[], maxQueries: number): string[] {
  const queries: string[] = [];
  for (const query of STATIC_QUERIES) addUnique(queries, query);

  for (const position of positions) {
    for (const query of buildPositionQueries(position)) {
      addUnique(queries, query);
      if (queries.length >= maxQueries) return queries;
    }
  }

  return queries.slice(0, maxQueries);
}

function matchPosition(event: GammaEvent, position: PortfolioPositionForPolymarket): PolymarketMatchedPosition | null {
  const title = `${event.title || ''} ${event.description || ''} ${tagSlugs(event).join(' ')}`;
  const haystack = compact(title);
  const terms: { term: string; reason: string }[] = [];
  const code = tickerCode(position.tickerBbg);
  if (code && /^[A-Z]{2,6}$/i.test(code)) terms.push({ term: code, reason: `ticker ${code}` });

  const company = cleanCompanyName(position.nameEn || position.nameCn);
  if (company.length >= 4) terms.push({ term: company, reason: 'company name' });
  if ((position.nameCn || '').trim().length >= 2) terms.push({ term: position.nameCn, reason: 'company Chinese name' });

  for (const rule of EXPOSURE_QUERY_RULES) {
    if (rule.pattern.test(positionSearchText(position))) {
      for (const query of rule.queries) terms.push({ term: query, reason: rule.reason });
      const sectorTerms = [position.sectorName, position.gicIndustry, position.sector?.name, position.theme?.name, position.topdown?.name].filter(Boolean) as string[];
      for (const term of sectorTerms) {
        if (term.length >= 2) terms.push({ term, reason: rule.reason });
      }
    }
  }

  const matched = terms.find(({ term }) => {
    const needle = compact(term);
    return needle.length >= 2 && haystack.includes(needle);
  });
  if (!matched) return null;

  return {
    id: position.id,
    tickerBbg: position.tickerBbg,
    name: position.nameCn || position.nameEn || position.tickerBbg,
    side: position.longShort === 'short' ? 'short' : position.longShort === 'long' ? 'long' : 'watchlist',
    weight: position.positionWeight || 0,
    reason: matched.reason,
  };
}

async function searchPolymarket(query: string, limit: number): Promise<GammaEvent[]> {
  const url = new URL('/public-search', GAMMA_BASE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polymarket search failed (${res.status}) for ${query}`);
  const payload = await res.json() as { events?: GammaEvent[] };
  return payload.events || [];
}

function normalizeEvent(event: GammaEvent, matchedQueries: string[], matchedPositions: PolymarketMatchedPosition[]): PolymarketMatchedMarket {
  const probability = yesProbability(event);
  return {
    eventId: String(event.id),
    title: cleanText(event.title || ''),
    slug: event.slug,
    url: `${POLYMARKET_BASE_URL}/${event.slug}`,
    description: cleanText(event.description || '').slice(0, 1200),
    endDate: event.endDate,
    volume: toNumber(event.volume),
    liquidity: toNumber(event.liquidity),
    volume24hr: toNumber(event.volume24hr),
    volume1wk: toNumber(event.volume1wk),
    yesProbability: probability,
    probabilityLabel: probability == null ? 'n/a' : `${probability.toFixed(1)}% Yes`,
    matchedQueries,
    matchedPositions,
    tags: tagSlugs(event),
  };
}

function escapeMarkdown(value: string): string {
  return (value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function marketImpactHint(market: PolymarketMatchedMarket): string {
  const title = market.title.toLowerCase();
  if (/bitcoin|btc|microstrategy/.test(title)) return 'BTC 概率信号会传导到 bitcoin miner、crypto beta 和高 beta 风险偏好。';
  if (/wti|crude|oil|lng|qatar|iran|hormuz/.test(title)) return '油气/运输/供应风险会传导到 XLE、石油公司、LNG 和通胀敏感仓位。';
  if (/fed|rate|inflation|cpi|powell/.test(title)) return '利率与通胀概率会影响估值折现、美元流动性、成长股和大宗商品。';
  if (/tariff|trade/.test(title)) return '关税概率会影响汽车、太阳能、工业品和中国出口链。';
  if (/data center|nvidia|ai/.test(title)) return 'AI 数据中心概率会传导到电力设备、冷却、燃机、电网和数据中心供应链。';
  if (/solar|green|renewable/.test(title)) return '绿电/太阳能概率会影响 TAN 及相关新能源暴露。';
  if (/china|india|macron|france|ukraine|russia/.test(title)) return '地缘政治概率会影响区域风险溢价、货币和相关国家敞口。';
  if (/earnings|eps|revenue/.test(title)) return '财报 beat/miss 概率可作为持仓事件风险和拥挤预期信号。';
  return '该预测市场与持仓或主题有文本/行业映射，需由 Portfolio Impact 判断实际传导。';
}

function buildFeedContent(markets: PolymarketMatchedMarket[], queries: string[], positions: PortfolioPositionForPolymarket[]) {
  const lines: string[] = [];
  lines.push('# Polymarket Portfolio Probability Radar');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push('来源：Polymarket Gamma API（公开市场、无需认证）。');
  lines.push('');
  lines.push('用途：把 Polymarket 的 crowd-implied probability 当作 portfolio impact 的信息流输入；它不是完整行情源，也不是交易建议。');
  lines.push('');
  lines.push(`覆盖持仓：${positions.length} 个；查询词：${queries.join(' / ')}`);
  lines.push('');
  lines.push('## 匹配市场');
  lines.push('');
  if (!markets.length) {
    lines.push('当前没有匹配到满足条件的 Polymarket 市场。');
  }

  markets.forEach((market, index) => {
    lines.push(`### ${index + 1}. ${market.title}`);
    lines.push('');
    lines.push(`- URL: ${market.url}`);
    lines.push(`- 概率: ${market.probabilityLabel}`);
    lines.push(`- Volume: ${Math.round(market.volume).toLocaleString('en-US')} / Liquidity: ${Math.round(market.liquidity).toLocaleString('en-US')}`);
    lines.push(`- End date: ${market.endDate || 'n/a'}`);
    lines.push(`- Tags: ${market.tags.join(', ') || 'n/a'}`);
    lines.push(`- 匹配查询: ${market.matchedQueries.join(', ')}`);
    lines.push(`- 组合映射: ${market.matchedPositions.map((p) => `${p.tickerBbg} ${p.side} ${(p.weight * 100).toFixed(1)}% (${p.reason})`).join('; ')}`);
    lines.push(`- 传导提示: ${marketImpactHint(market)}`);
    if (market.description) lines.push(`- 市场描述: ${market.description}`);
    lines.push('');
  });

  lines.push('## 结构化表');
  lines.push('');
  lines.push('| Market | Probability | Volume | Liquidity | End | Mapped positions |');
  lines.push('|---|---:|---:|---:|---|---|');
  for (const market of markets) {
    lines.push(`| ${escapeMarkdown(market.title)} | ${market.probabilityLabel} | ${Math.round(market.volume)} | ${Math.round(market.liquidity)} | ${market.endDate || ''} | ${escapeMarkdown(market.matchedPositions.map((p) => p.tickerBbg).join(', '))} |`);
  }

  return lines.join('\n');
}

function buildReferenceData(markets: PolymarketMatchedMarket[]) {
  return markets.map((market, index) => ({
    refNumber: index + 1,
    title: market.title,
    source: 'Polymarket',
    url: market.url,
    publishedAt: new Date().toISOString(),
    metadata: {
      eventId: market.eventId,
      slug: market.slug,
      probability: market.yesProbability,
      volume: market.volume,
      liquidity: market.liquidity,
      endDate: market.endDate,
      tags: market.tags,
      matchedPositions: market.matchedPositions,
    },
  }));
}

export async function syncPolymarketPortfolioFeed(userId: string, options: SyncOptions = {}) {
  const maxPositions = clampInt(options.maxPositions, 80, 1, 200);
  const maxQueries = clampInt(options.maxQueries, 36, 1, 80);
  const maxMarkets = clampInt(options.maxMarkets, 35, 1, 100);
  const minVolume = Math.max(0, Number(options.minVolume || 0));

  const rawPositions = await prisma.portfolioPosition.findMany({
    where: {
      userId,
      longShort: { in: ['long', 'short', '/'] },
    },
    include: { sector: true, theme: true, topdown: true },
  }) as PortfolioPositionForPolymarket[];

  const positions = rawPositions
    .filter((position) => position.longShort === 'long' || position.longShort === 'short' || Math.abs(position.positionAmount || 0) > 0)
    .sort((a, b) => Math.abs(b.positionAmount || 0) - Math.abs(a.positionAmount || 0))
    .slice(0, maxPositions);

  const queries = buildQueries(positions, maxQueries);
  const eventMap = new Map<string, { event: GammaEvent; queries: Set<string> }>();
  const warnings: string[] = [];

  for (const query of queries) {
    try {
      const events = await searchPolymarket(query, 8);
      for (const event of events) {
        if (!event?.id || !event.slug || event.closed || event.archived || isBlockedEvent(event)) continue;
        const existing = eventMap.get(String(event.id));
        if (existing) {
          existing.queries.add(query);
        } else {
          eventMap.set(String(event.id), { event, queries: new Set([query]) });
        }
      }
    } catch (error: any) {
      warnings.push(error?.message || `Failed query: ${query}`);
    }
  }

  const matchedMarkets = Array.from(eventMap.values())
    .map(({ event, queries: matchedQueries }) => {
      const matchedPositions = positions
        .map((position) => matchPosition(event, position))
        .filter((item): item is PolymarketMatchedPosition => Boolean(item));
      return matchedPositions.length ? normalizeEvent(event, Array.from(matchedQueries), matchedPositions) : null;
    })
    .filter((market): market is PolymarketMatchedMarket => Boolean(market))
    .filter((market) => market.volume >= minVolume)
    .sort((a, b) => b.volume - a.volume || b.liquidity - a.liquidity)
    .slice(0, maxMarkets);

  const content = buildFeedContent(matchedMarkets, queries, positions);
  const today = new Date().toISOString().slice(0, 10);
  const reportKey = `polymarket-portfolio-impact-${today}`;
  const title = `Polymarket Portfolio Radar - ${today} (${matchedMarkets.length} markets)`;
  const tags = Array.from(new Set([
    'Polymarket',
    'Portfolio Impact',
    'Prediction Market',
    ...matchedMarkets.flatMap((market) => market.matchedPositions.map((position) => tickerCode(position.tickerBbg))).filter(Boolean).slice(0, 30),
  ]));

  let feedItem = null;
  if (!options.dryRun) {
    const data = {
      userId,
      type: 'macro',
      category: '预测市场',
      title,
      content,
      contentFormat: 'markdown',
      source: 'polymarket-gamma-api',
      tags: JSON.stringify(tags),
      reportKey,
      reportVersion: new Date().toISOString(),
      reportType: 'polymarket_portfolio_radar',
      reportTypeLabel: 'Polymarket Portfolio Radar',
      originalName: '',
      htmlUrl: '',
      referenceData: JSON.stringify(buildReferenceData(matchedMarkets)),
      publishedAt: new Date(),
      pushedAt: new Date(),
      isRead: false,
    };
    const existing = await prisma.feedItem.findFirst({
      where: { userId, reportKey },
      orderBy: { updatedAt: 'desc' },
    });
    feedItem = existing
      ? await prisma.feedItem.update({ where: { id: existing.id }, data })
      : await prisma.feedItem.create({ data });
  }

  return {
    feedItem,
    matchedMarkets,
    queryCount: queries.length,
    checkedPositionCount: positions.length,
    warnings,
  };
}
