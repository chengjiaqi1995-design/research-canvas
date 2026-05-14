import crypto from 'crypto';
import axios from 'axios';
import prisma from '../utils/db';
import { postProcessQueue } from './transcriptionQueue';
import { performPostProcessing } from '../controllers/transcription/helpers';
import {
  getEarningCallTranscript,
  getEarningsCalendar,
  getInstitutionalOwnershipBySymbol,
  searchInsiderTrades,
  getStockNews,
  getTranscriptDates,
  hasFmpApiKey,
  type FmpInsiderTradeItem,
  type FmpInstitutionalOwnershipItem,
  type FmpStockNewsItem,
  type FmpTranscriptDateItem,
  type FmpTranscriptItem,
} from './fmpService';
import { bbgToFmpSymbolCandidates } from './fmpSymbolMapper';
import { collectPublicPortfolioNews } from './publicPortfolioNewsService';

type PortfolioSymbol = {
  positionId: number;
  symbol: string;
  tickerBbg: string;
  name: string;
  nameEn: string;
  nameCn: string;
  longShort: string;
  positionWeight: number;
  sectorName: string;
};

export type FmpIngestMode = 'news' | 'transcripts' | 'all';

export type FmpIngestResult = {
  mode: FmpIngestMode;
  userId: string;
  symbols: number;
  news: {
    fetched: number;
    created: number;
    skipped: number;
    filtered?: number;
    included?: number;
    shareholderIncluded?: number;
    monitorTotal?: number;
  };
  transcripts: { checked: number; created: number; skipped: number };
  warnings: string[];
};

function isoDateDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hashKey(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 24);
}

function normalizeTags(tags: string[]): string {
  return JSON.stringify(Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12));
}

function safeDate(value?: string): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function fmpSourceUrl(symbol: string, year?: number, quarter?: number): string {
  return `fmp://earning-call-transcript/${symbol}/${year || 'unknown'}/Q${quarter || 'unknown'}`;
}

function cleanProviderKey(value?: string): string {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\r\n\t ]+/g, '');
}

function getProviderKeysFromEnv(): Record<string, string> {
  return {
    google: cleanProviderKey(process.env.GEMINI_API_KEY),
    dashscope: cleanProviderKey(process.env.QWEN_API_KEY),
    openai: cleanProviderKey(process.env.OPENAI_API_KEY),
    deepseek: cleanProviderKey(process.env.DEEPSEEK_API_KEY),
  };
}

function hasSummaryKey(keys: Record<string, string>): boolean {
  return Boolean(keys.google || keys.dashscope || keys.openai || keys.deepseek);
}

function preferredSummaryModel(keys: Record<string, string>): string {
  if (keys.google) return 'gemini';
  if (keys.dashscope) return 'qwen';
  if (keys.openai) return 'openai';
  if (keys.deepseek) return 'deepseek';
  return 'gemini';
}

async function loadPortfolioSymbols(userId: string): Promise<PortfolioSymbol[]> {
  const positions = await prisma.portfolioPosition.findMany({
    where: { userId },
    select: {
      id: true,
      tickerBbg: true,
      nameEn: true,
      nameCn: true,
      market: true,
      longShort: true,
      positionWeight: true,
      sectorName: true,
    },
    orderBy: { positionAmount: 'desc' },
  });

  const seen = new Set<string>();
  const symbols: PortfolioSymbol[] = [];
  for (const position of positions) {
    const candidate = bbgToFmpSymbolCandidates(position.tickerBbg, position.market)[0];
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    symbols.push({
      positionId: position.id,
      symbol: candidate,
      tickerBbg: position.tickerBbg,
      name: position.nameCn || position.nameEn || position.tickerBbg,
      nameEn: position.nameEn || '',
      nameCn: position.nameCn || '',
      longShort: position.longShort,
      positionWeight: position.positionWeight,
      sectorName: position.sectorName,
    });
  }
  return symbols;
}

async function createFeedIfMissing(data: {
  userId: string;
  type: string;
  category: string;
  title: string;
  content: string;
  source: string;
  tags: string[];
  reportKey: string;
  reportType: string;
  reportTypeLabel: string;
  publishedAt?: string;
  referenceData?: unknown[];
}) {
  const existing = await prisma.feedItem.findFirst({
    where: { userId: data.userId, reportKey: data.reportKey },
    select: { id: true },
  });
  if (existing) return { created: false, id: existing.id };

  const item = await prisma.feedItem.create({
    data: {
      userId: data.userId,
      type: data.type,
      category: data.category,
      title: data.title,
      content: data.content,
      contentFormat: 'markdown',
      source: data.source,
      tags: normalizeTags(data.tags),
      reportKey: data.reportKey,
      reportVersion: new Date().toISOString(),
      reportType: data.reportType,
      reportTypeLabel: data.reportTypeLabel,
      referenceData: data.referenceData?.length ? JSON.stringify(data.referenceData) : '',
      publishedAt: safeDate(data.publishedAt),
      pushedAt: new Date(),
    },
  });
  return { created: true, id: item.id };
}

type PortfolioNewsCandidate = {
  news: FmpStockNewsItem;
  position?: PortfolioSymbol;
  sourceProvider: 'fmp' | 'public';
};

const FACTUAL_NEWS_PATTERNS = [
  /\b(earnings|revenue|profit|eps|guidance|outlook|forecast|results|quarter|fiscal|dividend|buyback|repurchase)\b/i,
  /\b(order|contract|backlog|shipment|delivery|customer|partnership|agreement|deal|tender)\b/i,
  /\b(acquire|acquisition|merger|m&a|divest|sale of|stake|joint venture|investment|financing|offering|loan|credit facility)\b/i,
  /\b(launch|unveil|release|approval|cleared|certified|permit|regulatory|antitrust|investigation|lawsuit|settlement|recall)\b/i,
  /\b(factory|plant|capacity|production|output|capex|project|facility|mine|drilling|reserve|supply|demand|inventory)\b/i,
  /\b(ceo|cfo|chairman|appoint|resign|management|board)\b/i,
  /\b(8-k|10-q|10-k|20-f|6-k|sec filing|form 4)\b/i,
  /业绩|收入|利润|指引|订单|合同|中标|交付|客户|合作|并购|收购|融资|回购|分红|产能|投产|项目|监管|处罚|诉讼|召回|减持|增持|权益变动|公告|管理层|董事|高管/,
];

const LOW_SIGNAL_NEWS_PATTERNS = [
  /\b(overvalued|undervalued|fair value|intrinsic value|gf value|guru ?focus|valuation)\b/i,
  /\b(price target|analyst|upgrade|downgrade|initiates?|maintains?|reiterates?|rating|buy rating|sell rating|hold rating)\b/i,
  /\b(why .*stock|shares? (rise|fall|jump|drop|slide|surge)|stock (rises|falls|jumps|drops|slides|surges)|premarket|after-hours)\b/i,
  /\b(why .*shares?|shares? (?:are )?(?:rising|falling|sliding|surging)|stock struggles|stock sinks|stock rallies)\b/i,
  /\b(fear and greed|investor sentiment|market sentiment|settles above|settles below|market summary)\b/i,
  /\b(options? activity|unusual options|top stocks|best stocks|watchlist|should you buy|buy, sell, or hold|cramer|meme stock)\b/i,
  /\b(winners?|losers?|stocks? to buy|stock i'd buy|massive winners|appealing etf|makes this etf appealing)\b/i,
  /\b(here'?s how much traders expect|expected to move|better .* stock|which is the better|is .* a buy|following earnings higher)\b/i,
  /\b(jumps? after earnings|stock price|war is boosting|boosting .* stocks?|former .* (?:ceo|cfo|executive|chairman).* joins)\b/i,
  /\b(vs\.| vs |versus|set for muted open|muted open|yield makes this etf)\b/i,
  /\b(market summary|stocks traded higher|traded higher toward the end|crude oil gains)\b/i,
  /\b(holdings reduced|raises stock position|makes new .*investment in|stake .* in|acquires .*shares of|sells .*shares of)\b/i,
  /\boverseas regulatory announcement\s*-\s*other\b/i,
  /\b(earnings due|what matters for|tipranks|eaton vance|kospi .*dividend shock|labor unrest)\b/i,
  /\b(investor alert|shareholder alert|class action|securities fraud|law firm|pomerantz|rosen law|levi\s*&\s*korsinsky|bragar eagel|deadline alert)\b/i,
  /高估|低估|估值|目标价|评级|上调评级|下调评级|分析师|股价上涨|股价下跌|为何.*上涨|为何.*下跌|市场情绪|值得买吗|集体诉讼|律师事务所提醒|投资者提醒|研报|点评|市占率|富途牛牛|雪球/,
];

const WIRE_LOW_SIGNAL_NEWS_PATTERNS = [
  /\b(to report|will report|plans? to report|scheduled to report|announces? date).{0,60}\b(financial results|quarterly results|earnings)\b/i,
  /\b(conference call|webcast|investor conference|fireside chat|presentation|roadshow|webinar|expo|trade show)\b/i,
  /\b(participat(?:e|es|ing) in|present(?:s|ing)? at|to host|will host|invited to)\b/i,
  /\b(awards?|recognized|recognition|ranked|named).{0,80}\b(best|top|leader|employer|workplace|innovation|sustainability)\b/i,
  /\b(esg|sustainability|carbon neutral|net zero|diversity|charity|donation|sponsor(?:ship)?|community)\b/i,
  /\b(certification|certified|certificate|efqm|zertifizierung)\b/i,
  /\b(groundbreaking ceremony|ribbon cutting|grand opening|opens?.{0,30}pre-orders?|launches? website)\b/i,
  /将于.{0,16}发布.{0,16}财务业绩|召开业绩说明会|参加投资者会议|网络直播|可持续发展|公益|赞助|获奖|荣获|评为/,
];

const WIRE_MATERIAL_NEWS_PATTERNS = [
  /\b(revenue|revenues|sales|profit|net income|eps|guidance|outlook|financial results|quarterly results|annual results)\b/i,
  /\b(contract|order|backlog|customer agreement|supply agreement|commercial agreement|purchase agreement|awarded? .{0,40}contract)\b/i,
  /\b(acquisition|merger|divest|joint venture|strategic investment|investment|financing|offering|loan|credit facility|debt|bond|capital raise)\b/i,
  /\b(factory|plant|capacity|production|shipment|delivery|project|facility|mine|drilling|reserve|restart|outage)\b/i,
  /\b(approval|regulatory|investigation|lawsuit|settlement|recall|permit|sanction|penalty|fine)\b/i,
  /\b(dividend|buyback|repurchase)\b/i,
  /\b(ceo|cfo|chairman|appoint|appointed|resign|resigned|management change|board change|director)\b/i,
  /业绩|收入|利润|指引|订单|合同|中标|交付|客户协议|供货协议|并购|收购|融资|回购|分红|产能|投产|项目|监管|处罚|诉讼|召回|减持|增持|权益变动|董事|高管|管理层/,
];

const LOW_SIGNAL_SOURCES = [
  /gurufocus\.com/i,
  /fool\.com/i,
  /etftrends\.com/i,
  /seekingalpha\.com/i,
  /zacks\.com/i,
  /marketbeat/i,
  /youtube\.com/i,
  /youtu\.be/i,
  /accesswire\.com\/viewarticle\.aspx/i,
  /futunn\.com/i,
  /tipranks/i,
];

const LOW_SIGNAL_URL_PATTERNS = [
  /\/markets\/market-summary\//i,
  /\/stock-ideas\//i,
];

const ETF_OR_INDEX_PATTERNS = [
  /\bETF\b/i,
  /\bTRUST\b/i,
  /\bFUND\b/i,
  /\bSPDR\b/i,
  /\bISHARES\b/i,
  /\bXTRCKR\b/i,
  /\bS&P\s*500\b/i,
  /\bCSI\s*300\b/i,
  /\bSELECT SECTOR\b/i,
];

const COMPANY_STOPWORDS = new Set([
  'ord',
  'class',
  'company',
  'corp',
  'corporation',
  'inc',
  'ltd',
  'plc',
  'group',
  'holdings',
  'holding',
  'international',
  'technologies',
  'technology',
  'energy',
  'systems',
  'global',
  'venture',
  'first',
  'general',
  'american',
  'national',
]);

const CORPORATE_NAME_TERMS = new Set([
  'ord',
  'class',
  'company',
  'corp',
  'corporation',
  'inc',
  'ltd',
  'plc',
  'group',
  'holdings',
  'holding',
  'equity',
  'common',
  'stock',
]);

const AMBIGUOUS_LEADING_COMPANY_TOKENS = new Set([
  'advanced',
  'american',
  'china',
  'clean',
  'first',
  'general',
  'global',
  'international',
  'national',
  'power',
  'solar',
  'united',
]);

function compactText(value = '', maxLength = 260): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function compactChineseLine(value = '', maxLength = 90): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function canonicalTitle(title = ''): string {
  return title
    .replace(/\s+-\s+[^-]{2,48}$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companyNameMatchTokens(position?: PortfolioSymbol): string[] {
  if (!position) return [];
  const sourceName = position.nameEn || position.name || position.tickerBbg;
  return sourceName
    .toLowerCase()
    .replace(/\b(equity|ord|common|stock|class)\b/g, ' ')
    .replace(/\bcl\s+[a-z]\b/g, ' ')
    .replace(/-w\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !['us', 'hk', 'ch', 'jp', 'ks', 'ln', 'gr', 'fp', 'in', 'li'].includes(token));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsEnglishToken(haystack: string, token: string): boolean {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(haystack);
}

function containsEnglishPhrase(haystack: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i').test(haystack);
}

function factualSourceRank(news: FmpStockNewsItem): number {
  const source = `${news.site || ''}\n${news.url || ''}`;
  if (/businesswire|prnewswire|globenewswire|sec\.gov|company-announcement|ir\./i.test(source)) return 4;
  if (/reuters|cnbc|wsj|bloomberg/i.test(source)) return 3;
  if (/zacks|proactiveinvestors|marketbeat/i.test(source)) return 1;
  return 2;
}

function isWireNewsSource(sourceOrNews: FmpStockNewsItem | PortfolioMonitorEntry): boolean {
  const record = sourceOrNews as Partial<FmpStockNewsItem & PortfolioMonitorEntry>;
  const source = `${record.sourceProvider || ''}\n${record.source || ''}\n${record.site || ''}\n${record.url || ''}`;
  return /prnewswire|globenewswire|businesswire/i.test(source);
}

function isCompanyPosition(position?: PortfolioSymbol): boolean {
  if (!position) return false;
  const haystack = `${position.nameEn || position.name || ''} ${position.tickerBbg || ''}`;
  return !ETF_OR_INDEX_PATTERNS.some((pattern) => pattern.test(haystack));
}

function companyTokens(position?: PortfolioSymbol): string[] {
  if (!position) return [];
  return Array.from(new Set(
    companyNameMatchTokens(position)
      .filter((token) => token.length >= 4 && !COMPANY_STOPWORDS.has(token)),
  )).slice(0, 8);
}

function companyRawTokens(position?: PortfolioSymbol): string[] {
  if (!position) return [];
  return Array.from(new Set(
    companyNameMatchTokens(position)
      .filter((token) => token.length >= 3 && !CORPORATE_NAME_TERMS.has(token)),
  )).slice(0, 8);
}

function canLeadingTokenStandAlone(rawTokens: string[], token: string): boolean {
  if (rawTokens.length < 2) return true;
  return token === rawTokens[0] && token.length >= 8 && !AMBIGUOUS_LEADING_COMPANY_TOKENS.has(token);
}

function matchesPortfolioCompany(news: FmpStockNewsItem, position?: PortfolioSymbol): boolean {
  if (!position) return false;
  const haystack = `${news.title || ''}\n${news.text || ''}`.toLowerCase();
  const chineseName = (position.nameCn || '').trim();
  if (chineseName && chineseName.length >= 2 && haystack.includes(chineseName.toLowerCase())) return true;
  const nameTokens = companyNameMatchTokens(position);
  if (nameTokens.length >= 2) {
    const phrase = nameTokens.slice(0, 2).join(' ');
    if (containsEnglishPhrase(haystack, phrase)) return true;
  }
  const rawTokens = companyRawTokens(position);
  if (rawTokens.length >= 2 && containsEnglishPhrase(haystack, rawTokens.slice(0, 2).join(' '))) return true;
  const tokens = companyTokens(position);
  if (tokens.length === 1) return canLeadingTokenStandAlone(rawTokens, tokens[0]) && containsEnglishToken(haystack, tokens[0]);
  if (tokens.length > 1) {
    const matched = tokens.filter((token) => containsEnglishToken(haystack, token));
    if (matched.length >= 2) return true;
    if (canLeadingTokenStandAlone(rawTokens, tokens[0]) && containsEnglishToken(haystack, tokens[0])) return true;
  }
  return false;
}

function isFactualPortfolioNews(news: FmpStockNewsItem, position?: PortfolioSymbol): boolean {
  if (!isCompanyPosition(position)) return false;
  if (!matchesPortfolioCompany(news, position)) return false;
  const haystack = `${news.title || ''}\n${news.text || ''}\n${news.site || ''}\n${news.url || ''}`;
  if (LOW_SIGNAL_SOURCES.some((pattern) => pattern.test(news.site || '') || pattern.test(news.url || ''))) return false;
  if (LOW_SIGNAL_URL_PATTERNS.some((pattern) => pattern.test(news.url || ''))) return false;
  if (LOW_SIGNAL_NEWS_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
  if (isWireNewsSource(news)) {
    if (WIRE_LOW_SIGNAL_NEWS_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
    return WIRE_MATERIAL_NEWS_PATTERNS.some((pattern) => pattern.test(haystack));
  }
  return FACTUAL_NEWS_PATTERNS.some((pattern) => pattern.test(haystack));
}

function twoHourBucketKey(now = new Date()): string {
  const bucket = new Date(now);
  bucket.setUTCMinutes(0, 0, 0);
  bucket.setUTCHours(Math.floor(bucket.getUTCHours() / 2) * 2);
  return bucket.toISOString().slice(0, 13);
}

function formatNewsTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function portfolioCompanyDisplayName(position?: PortfolioSymbol, news?: FmpStockNewsItem): string {
  const raw = position?.nameCn || position?.nameEn || position?.name || news?.symbol || '-';
  return raw
    .replace(/\s+ORD(?:\s+[A-Z])?$/i, '')
    .replace(/\s+CL\s+[A-Z]$/i, '')
    .replace(/-W$/i, '')
    .replace(/\s+COMMON\s+STOCK$/i, '')
    .replace(/\s+SPON(?:SORED)?\s+ADR.*$/i, ' ADR')
    .replace(/\s+ADR\s+EACH.*$/i, ' ADR')
    .replace(/\s{2,}/g, ' ')
    .trim() || raw;
}

function monthDayToChinese(text: string): string {
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/i);
  if (!match) return '';
  const monthMap: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return `${monthMap[match[1].toLowerCase()]}月${Number(match[2])}日`;
}

function fiscalPeriodToChinese(text: string): string {
  const year = text.match(/\b(20\d{2})\b/)?.[1] || '';
  const quarterMatch = text.match(/\b(first|second|third|fourth)\s+quarter\b|\bq([1-4])\b/i);
  if (!quarterMatch) return year ? `${year}年` : '';
  const quarterMap: Record<string, string> = { first: '一', second: '二', third: '三', fourth: '四' };
  const quarter = quarterMatch[2] || quarterMap[(quarterMatch[1] || '').toLowerCase()] || '';
  return `${year ? `${year}年` : ''}${quarter}季度`;
}

function cleanCounterpartyName(value = ''): string {
  return value
    .replace(/\b(first|second|third|fourth)\s+quarter\s+\d{4}\b/ig, '')
    .replace(/\bq[1-4]\s+\d{4}\b/ig, '')
    .replace(/[.;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackChineseNewsLine(news: FmpStockNewsItem): string {
  const title = news.title || '';
  const haystack = `${title}\n${news.text || ''}`.toLowerCase();
  const date = monthDayToChinese(title);
  const period = fiscalPeriodToChinese(title);
  const secForm = `${title}\n${news.text || ''}`.match(/\b(8-k|10-q|10-k|20-f|6-k)\b/i)?.[1]?.toUpperCase();

  if (secForm) {
    return `提交 SEC ${secForm} 文件。`;
  }

  if (/to report .*financial results/i.test(title)) {
    return `将于${date || '近期'}发布${period || '季度'}财务业绩。`;
  }
  if (/\bdividend\b/i.test(title)) {
    return '宣布股息或分红安排。';
  }
  if (/reports? .*quarter.*results|reports? .*results|announces? .*results/i.test(title)) {
    return `发布${period || '季度'}业绩。`;
  }
  if (/tops? profit estimates|beats? .*estimates|beat estimates/i.test(title)) {
    return '利润或收入高于市场预期。';
  }
  if (/signs? new .*supply deals? with (.+)/i.test(title)) {
    const counterparty = cleanCounterpartyName(title.match(/signs? new .*supply deals? with (.+)/i)?.[1] || '');
    return `与${counterparty || '客户'}签署新的供应协议。`;
  }
  if (/applies? for .*loans?/i.test(title)) {
    return '申请贷款或融资支持。';
  }
  if (/secondary offering/i.test(title)) {
    return '现有股东启动二次发行安排。';
  }
  if (/to employ .*reactor design|reactor design/i.test(title)) {
    return '披露先进反应堆设计合作进展。';
  }
  if (/three mile island.*restart|restart.*three mile island/i.test(title)) {
    return 'Three Mile Island 重启事项等待监管决定。';
  }
  if (/battery plant.*berlin|invest .*battery plant/i.test(title)) {
    return '将在柏林附近电池工厂追加投资。';
  }
  if (/robotaxi rollout/i.test(title)) {
    return '披露 Robotaxi 推出进展和排队等待情况。';
  }
  if (/annual meeting/i.test(title) && /nuclear demand/i.test(title)) {
    return '年会上表示核电需求强劲，并回顾业绩表现。';
  }
  if (/earnings call highlights/i.test(title)) {
    return '披露季度业绩电话会要点。';
  }
  if (/accidents|fatalities|operations on track/i.test(title)) {
    return '披露安全生产记录和运营进度。';
  }

  if (/report.*financial results|financial results on|results on|earnings date|conference call/i.test(haystack)) {
    return '将发布季度财务业绩并召开业绩说明会。';
  }
  if (/earnings|revenue|profit|eps|quarter|q[1-4]|guidance|sales/i.test(haystack)) {
    return '披露季度业绩、收入利润或经营指引更新。';
  }
  if (/contract|order|agreement|supply|partnership|customer|deal/i.test(haystack)) {
    return '披露新订单、合同或客户合作进展。';
  }
  if (/acqui|merger|divest|asset sale|joint venture|stake|investment/i.test(haystack)) {
    return '披露并购、资产交易或股权合作进展。';
  }
  if (/loan|credit facility|financing|offering|debt|bond|capital raise/i.test(haystack)) {
    return '披露融资、贷款或资本市场交易安排。';
  }
  if (/approval|regulat|permit|lawsuit|court|settlement|investigation/i.test(haystack)) {
    return '披露监管、审批、诉讼或和解进展。';
  }
  if (/appoint|resign|ceo|cfo|chairman|board|management/i.test(haystack)) {
    return '宣布管理层或董事会人员变动。';
  }
  if (/production|capacity|factory|plant|shipment|delivery|operation|restart|outage/i.test(haystack)) {
    return '披露生产、产能、交付或运营进展。';
  }
  if (/product|launch|technology|clinical|trial|patent/i.test(haystack)) {
    return '披露产品、技术或研发进展。';
  }
  return '发布一条公司事实公告。';
}

function cleanOfficialDisclosureTitle(title = ''): string {
  return title
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^([^：:]{1,36})[：:]\s*/, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim();
}

function buildOfficialDisclosureLine(news: FmpStockNewsItem, metrics: string[]): string | null {
  const source = `${news.site || ''}\n${news.url || ''}`;
  const title = cleanOfficialDisclosureTitle(news.title || '');
  if (!title) return null;
  const isOfficial = /cninfo|hkexnews|hkex\.|sec\.gov|sec edgar/i.test(source);
  const hasChinese = /[\u4e00-\u9fff]/.test(title);
  if (!isOfficial && !hasChinese) return null;
  if (/月报表|翌日披露报表|董事名单与其角色和职能|职权范围|代表委任表格|代理人委任表格/i.test(title)) return null;
  if (/^\s*(年度报告|半年度报告|一季度报告|三季度报告|季度报告|annual report|interim report)\s*$/i.test(title) && !metrics.length) return null;
  const translatedTitle = translateOfficialDisclosureTitle(title);
  if (metrics.length) return `${compactChineseLine(translatedTitle, 64)}：${metrics.slice(0, 4).join('，')}。`;
  return `${compactChineseLine(translatedTitle, 88)}。`;
}

function translateOfficialDisclosureTitle(title: string): string {
  const bracket = title.match(/\[([^\]]+)\]/)?.[1] || title;
  if (/date of board meeting/i.test(bracket)) return '公告董事会会议日期';
  if (/results announcement|annual results|interim results|quarterly results/i.test(bracket)) return '发布业绩公告';
  if (/inside information/i.test(bracket)) return '披露内幕消息公告';
  if (/overseas regulatory announcement/i.test(bracket)) return '披露境外监管公告';
  if (/change in directors|change of directors|board/i.test(bracket)) return '公告董事会或高管变动';
  if (/share buyback|repurchase/i.test(bracket)) return '公告股份回购安排';
  if (/major transaction|connected transaction|discloseable transaction/i.test(bracket)) return '公告重大交易或关联交易';
  if (/profit warning/i.test(bracket)) return '发布盈利警告';
  if (/profit alert/i.test(bracket)) return '发布盈利预喜';
  return title;
}

type PortfolioMonitorKind = 'news' | 'insider' | 'institutional';

type PortfolioMonitorEntry = {
  kind: PortfolioMonitorKind;
  dedupeKey: string;
  timestamp: string;
  company: string;
  symbol: string;
  tickerBbg: string;
  content: string;
  url: string;
  source: string;
  title: string;
  refNumber?: number;
  ref?: string;
  sourceProvider?: string;
};

const MONITOR_REPORT_KEY = 'portfolio-fmp-monitor:rolling-30d';
const MONITOR_RETENTION_DAYS = 30;
const MAX_MONITOR_COLUMN_ITEMS = 220;

const articleTextCache = new Map<string, Promise<string>>();

function normalizeHtmlReport(html: string): string {
  let normalized = html || '';
  normalized = normalized.replace(/<\/script>(?!\s*(?:<|$))/gi, '<\\/script>');
  normalized = normalized.replace(/<\/script>(?=\s*["'`])/gi, '<\\/script>');
  if (!/<meta\s+charset=/i.test(normalized)) {
    normalized = normalized.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
  }
  return normalized;
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
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchArticleText(url?: string): Promise<string> {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  if (!articleTextCache.has(url)) {
    articleTextCache.set(url, (async () => {
      try {
        const response = await axios.get<string>(url, {
          timeout: 5000,
          responseType: 'text',
          maxContentLength: 500_000,
          maxRedirects: 3,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ResearchCanvasBot/1.0; +https://research-canvas.local)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          },
        });
        return stripHtmlText(String(response.data || '')).slice(0, 8000);
      } catch {
        return '';
      }
    })());
  }
  return articleTextCache.get(url)!;
}

function escapeHtml(value = ''): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMonitorTime(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return value || '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Singapore',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '/');
}

function formatReportVersion(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

function formatMoneyValue(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/\$?\s*(-?\d[\d,.]*)(?:\s*(billion|million|bn|m|b))?/i);
  if (!match) return cleaned;
  const amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return cleaned;
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'billion' || unit === 'bn' || unit === 'b') return `${Number((amount * 10).toFixed(1))}亿美元`;
  if (unit === 'million' || unit === 'm') {
    if (Math.abs(amount) >= 100) return `${Number((amount / 100).toFixed(2))}亿美元`;
    return `${Number(amount.toFixed(1))}百万美元`;
  }
  if (/^\$/.test(cleaned) && Math.abs(amount) >= 1_000_000) return formatDollar(amount);
  return `$${match[1]}`;
}

function normalizePercentValue(raw: string): string {
  const match = raw.match(/-?\d+(?:\.\d+)?\s*%/);
  return match ? match[0].replace(/\s+/g, '') : raw.trim();
}

function formatShares(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `${Number((value / 100_000_000).toFixed(2))}亿股`;
  if (abs >= 10_000) return `${Number((value / 10_000).toFixed(1))}万股`;
  return `${Math.round(value).toLocaleString('en-US')}股`;
}

function formatDollar(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(2))}十亿美元`;
  if (abs >= 100_000_000) return `${Number((value / 100_000_000).toFixed(2))}亿美元`;
  if (abs >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}百万美元`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function extractMetricFacts(text: string, maxFacts = 4): string[] {
  const compact = compactText(text, 6000);
  const facts: string[] = [];
  const add = (fact: string) => {
    const cleaned = fact.replace(/\s+/g, ' ').trim();
    const label = cleaned.match(/^(收入|净利润|调整后EBITDA|EBITDA|EPS变动|EPS|收入变动|金额|规模|发行规模)/)?.[1];
    if (label && facts.some((existing) => existing.startsWith(label))) return;
    if (cleaned && !facts.includes(cleaned)) facts.push(cleaned);
  };
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/\b(?:total\s+)?(?:revenue|revenues|sales|net sales)\b[^.。;\n]{0,90}?(\$?\s*-?\d[\d,.]*\s*(?:billion|million|bn|m|b))/gi, (m) => `收入${formatMoneyValue(m[1])}`],
    [/\b(?:net income|net profit|profit)\b[^.。;\n]{0,90}?(\$?\s*-?\d[\d,.]*\s*(?:billion|million|bn|m|b))/gi, (m) => `净利润${formatMoneyValue(m[1])}`],
    [/\badjusted\s+ebitda\b[^.。;\n]{0,90}?(\$?\s*-?\d[\d,.]*\s*(?:billion|million|bn|m|b))/gi, (m) => `调整后EBITDA ${formatMoneyValue(m[1])}`],
    [/\bebitda\b[^.。;\n]{0,90}?(\$?\s*-?\d[\d,.]*\s*(?:billion|million|bn|m|b))/gi, (m) => `EBITDA ${formatMoneyValue(m[1])}`],
    [/\b(?:eps|earnings per share)\b[^.。;\n]{0,80}?(\$?\s*-?\d+(?:\.\d+)?)/gi, (m) => `EPS ${m[1].replace(/\s+/g, '')}`],
    [/\b(?:revenue|revenues|sales)\b[^.。;\n]{0,80}?(?:rose|increased|grew|surged|jumped|up|declined|decreased|fell|down)[^.。;\n]{0,40}?(-?\d+(?:\.\d+)?\s*%)/gi, (m) => `收入变动${normalizePercentValue(m[1])}`],
    [/\b(?:eps|earnings per share)\b[^.。;\n]{0,80}?(?:rose|increased|grew|surged|jumped|up|declined|decreased|fell|down)[^.。;\n]{0,40}?(-?\d+(?:\.\d+)?\s*%)/gi, (m) => `EPS变动${normalizePercentValue(m[1])}`],
    [/\b(?:offering|stock offering|secondary offering)\b[^.。;\n]{0,120}?(\d[\d,.]*\s*(?:shares?|class a shares?))/gi, (m) => `发行规模${formatShares(Number(m[1].replace(/[^0-9.]/g, '')))}`],
    [/\b(?:capex|investment|invest|loan|credit facility|financing|amount)\b[^.。;\n]{0,100}?(\$?\s*-?\d[\d,.]*\s*(?:billion|million|bn|m|b))/gi, (m) => `金额${formatMoneyValue(m[1])}`],
    [/\b(?:capex|investment|invest|loan|credit facility|financing|amount)\b[^.。;\n]{0,100}?(\$\s*-?\d[\d,.]*)/gi, (m) => `金额${formatMoneyValue(m[1])}`],
    [/\b(?:capacity|production|output|shipments?|deliveries|operations?)\b[^.。;\n]{0,100}?(\d[\d,.]*\s*(?:ktpy|mw|gw|gwh|mwh|tons?|tonnes?|vehicles?|units?|%))/gi, (m) => `规模${m[1].replace(/\s+/g, ' ')}`],
    [/(\d[\d,.]*\s*(?:ktpy|mw|gw|gwh|mwh|tons?|tonnes?|vehicles?|units?))/gi, (m) => `规模${m[1].replace(/\s+/g, ' ')}`],
  ];

  for (const [regex, formatter] of patterns) {
    for (const match of compact.matchAll(regex)) {
      add(formatter(match));
      if (facts.length >= maxFacts) return facts;
    }
  }
  return facts;
}

function isResultsLikeNews(news: FmpStockNewsItem): boolean {
  const text = `${news.title || ''}\n${news.text || ''}`;
  return /\b(results|earnings|revenue|revenues|eps|profit|quarter|fiscal|q[1-4])\b/i.test(text);
}

function isEmptyResultsHeadline(news: FmpStockNewsItem): boolean {
  return /\b(reports?|announces?|posts?)\s+(?:first|second|third|fourth|q[1-4]|quarter|fiscal|annual).*results\b|\bearnings call highlights\b/i.test(news.title || '');
}

function buildDeterministicNewsLine(news: FmpStockNewsItem, richText: string): string | null {
  const title = news.title || '';
  const combined = `${title}\n${news.text || ''}\n${richText || ''}`;
  const period = fiscalPeriodToChinese(combined);
  const date = monthDayToChinese(combined);
  const metrics = extractMetricFacts(combined);
  const officialLine = buildOfficialDisclosureLine(news, metrics);
  if (officialLine) return officialLine;

  if (/to report .*financial results/i.test(title)) {
    return `将于${date || '近期'}发布${period || '季度'}财务业绩。`;
  }
  if (isResultsLikeNews(news)) {
    if (!metrics.length) return null;
    if (metrics.length) return `${period || '季度'}业绩：${metrics.slice(0, 4).join('，')}。`;
  }

  const base = fallbackChineseNewsLine(news).replace(/。$/, '');
  if (/three mile island.*restart|restart.*three mile island/i.test(title) && /\bjune\b/i.test(title)) {
    return 'Three Mile Island 重启事项可能在6月获得监管决定。';
  }
  if (/billions of dollars/i.test(`${title}\n${news.text || ''}`)) {
    return `${base}，规模为数十亿美元级别。`;
  }
  const nonResultMetrics = metrics.filter((metric) => /^(金额|规模|发行规模)/.test(metric));
  if (nonResultMetrics.length) return `${base}：${nonResultMetrics.slice(0, 3).join('，')}。`;
  return `${base}。`;
}

async function buildNewsMonitorEntry(candidate: PortfolioNewsCandidate): Promise<PortfolioMonitorEntry | null> {
  const { news, position } = candidate;
  let richText = `${news.title || ''}\n${news.text || ''}`;
  let content = buildDeterministicNewsLine(news, richText);
  if (!content && news.url) {
    const articleText = await fetchArticleText(news.url);
    richText = `${richText}\n${articleText}`;
    content = buildDeterministicNewsLine(news, richText);
  }
  if (!content) return null;
  const dedupeKey = hashKey(['news', news.symbol, news.publishedAt, news.url || news.title].join('|'));
  return {
    kind: 'news',
    dedupeKey,
    timestamp: safeDate(news.publishedAt).toISOString(),
    company: portfolioCompanyDisplayName(position, news),
    symbol: news.symbol,
    tickerBbg: position?.tickerBbg || '',
    content,
    url: news.url || '',
    source: news.site || 'FMP',
    title: news.title || content,
    sourceProvider: candidate.sourceProvider,
  };
}

function parseMonitorEntries(value: unknown): PortfolioMonitorEntry[] {
  if (!value) return [];
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const entry = item as Partial<PortfolioMonitorEntry>;
      if (!entry.kind || !entry.dedupeKey || !entry.timestamp || !entry.content) return null;
      if (!['news', 'insider', 'institutional'].includes(entry.kind)) return null;
      return {
        kind: entry.kind,
        dedupeKey: entry.dedupeKey,
        timestamp: entry.timestamp,
        company: entry.company || entry.symbol || '-',
        symbol: entry.symbol || '',
        tickerBbg: entry.tickerBbg || '',
        content: entry.content,
        url: entry.url || '',
        source: entry.source || 'FMP',
        title: entry.title || entry.content,
        sourceProvider: entry.sourceProvider || '',
      } as PortfolioMonitorEntry;
    })
    .filter((entry): entry is PortfolioMonitorEntry => Boolean(entry));
}

function mergeMonitorEntries(existing: PortfolioMonitorEntry[], incoming: PortfolioMonitorEntry[], now = new Date()): PortfolioMonitorEntry[] {
  const cutoff = now.getTime() - MONITOR_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const byKey = new Map<string, PortfolioMonitorEntry>();
  for (const entry of [...existing, ...incoming]) {
    const time = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(time) || time < cutoff) continue;
    if (!isMonitorEntryStillValid(entry)) continue;
    byKey.set(entry.dedupeKey, entry);
  }
  const seenNewsTitles = new Set<string>();
  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .filter((entry) => {
      if (entry.kind !== 'news') return true;
      const key = canonicalTitle(entry.title || entry.content);
      if (!key) return true;
      if (seenNewsTitles.has(key)) return false;
      seenNewsTitles.add(key);
      return true;
    });
}

function monitorCompanyTokens(company = ''): string[] {
  return company
    .toLowerCase()
    .replace(/\b(equity|ord|common|stock|class)\b/g, ' ')
    .replace(/-w\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !COMPANY_STOPWORDS.has(token))
    .slice(0, 6);
}

function monitorCompanyRawTokens(company = ''): string[] {
  return company
    .toLowerCase()
    .replace(/\b(equity|ord|common|stock|class)\b/g, ' ')
    .replace(/-w\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !CORPORATE_NAME_TERMS.has(token))
    .slice(0, 6);
}

function monitorEntryMatchesCompany(entry: PortfolioMonitorEntry): boolean {
  const haystack = `${entry.title || ''}\n${entry.content || ''}\n${entry.url || ''}`.toLowerCase();
  const company = entry.company || '';
  const chineseName = company.match(/[\u4e00-\u9fff]{2,}/)?.[0];
  if (chineseName && haystack.includes(chineseName.toLowerCase())) return true;
  const symbolRoot = (entry.symbol || '').split('.')[0];
  if (/^[A-Z0-9-]{2,8}$/.test(symbolRoot) && !/^\d+$/.test(symbolRoot) && containsEnglishToken(haystack, symbolRoot.toLowerCase())) return true;
  const rawTokens = monitorCompanyRawTokens(company);
  if (rawTokens.length >= 2 && containsEnglishPhrase(haystack, rawTokens.slice(0, 2).join(' '))) return true;
  const tokens = monitorCompanyTokens(company);
  if (!tokens.length) return true;
  if (tokens.length >= 2 && containsEnglishPhrase(haystack, tokens.slice(0, 2).join(' '))) return true;
  if (tokens.length === 1) {
    if (!canLeadingTokenStandAlone(rawTokens, tokens[0])) return false;
    return containsEnglishToken(haystack, tokens[0]);
  }
  const matched = tokens.filter((token) => containsEnglishToken(haystack, token));
  return matched.length >= 2 || (canLeadingTokenStandAlone(rawTokens, tokens[0]) && containsEnglishToken(haystack, tokens[0]));
}

function isPublisherHomepageUrl(url = ''): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (!parsed.pathname || parsed.pathname === '/') && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function isMonitorEntryStillValid(entry: PortfolioMonitorEntry): boolean {
  if (entry.kind !== 'news') return true;
  const haystack = `${entry.title || ''}\n${entry.content || ''}\n${entry.source || ''}\n${entry.url || ''}`;
  if (/^https:\/\/news\.google\.com\/rss\/articles\//i.test(entry.url || '')) return false;
  if (isPublisherHomepageUrl(entry.url || '')) return false;
  if (LOW_SIGNAL_SOURCES.some((pattern) => pattern.test(entry.source || '') || pattern.test(entry.url || ''))) return false;
  if (LOW_SIGNAL_URL_PATTERNS.some((pattern) => pattern.test(entry.url || ''))) return false;
  if (LOW_SIGNAL_NEWS_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
  if (isWireNewsSource(entry)) {
    if (WIRE_LOW_SIGNAL_NEWS_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
    if (!WIRE_MATERIAL_NEWS_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
  }
  return monitorEntryMatchesCompany(entry);
}

function renderNewsColumn(entries: PortfolioMonitorEntry[], emptyText: string): string {
  const items = entries.slice(0, MAX_MONITOR_COLUMN_ITEMS);
  if (!items.length) {
    return `<section class="panel news-panel"><h2>公司新闻</h2><div class="empty">${escapeHtml(emptyText)}</div></section>`;
  }
  return [
    '<section class="panel news-panel">',
    `<h2>公司新闻 <span>${items.length}</span></h2>`,
    '<div class="item-list news-list">',
    ...items.map((entry) => [
      '<article class="monitor-item">',
      `<time>${escapeHtml(formatMonitorTime(entry.timestamp))}</time>`,
      `<strong>${escapeHtml(entry.company)}</strong>`,
      `<p>${escapeHtml(entry.content)}</p>`,
      entry.source ? `<em>${escapeHtml(entry.source)}</em>` : '<em></em>',
      entry.url ? `<a class="source-link" href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">↗</a>` : '',
      '</article>',
    ].join('')),
    '</div>',
    '</section>',
  ].join('\n');
}

function renderShareholderColumn(entries: PortfolioMonitorEntry[], emptyText: string): string {
  const items = entries.slice(0, MAX_MONITOR_COLUMN_ITEMS);
  const insiderCount = items.filter((entry) => entry.kind === 'insider').length;
  const institutionalCount = items.filter((entry) => entry.kind === 'institutional').length;
  if (!items.length) {
    return `<section class="panel shareholder-panel"><h2>股东持股变动</h2><div class="empty">${escapeHtml(emptyText)}</div></section>`;
  }
  return [
    '<section class="panel shareholder-panel" data-filter="all">',
    '<div class="panel-head">',
    `<h2>股东持股变动 <span>${items.length}</span></h2>`,
    '<div class="filter-controls" role="group" aria-label="股东持股变动筛选">',
    `<button type="button" class="active" data-filter-button="all">全部 ${items.length}</button>`,
    `<button type="button" data-filter-button="institutional">13F ${institutionalCount}</button>`,
    `<button type="button" data-filter-button="insider">Insider ${insiderCount}</button>`,
    '</div>',
    '</div>',
    '<div class="item-list">',
    ...items.map((entry) => [
      `<article class="monitor-item" data-kind="${escapeHtml(entry.kind)}">`,
      `<div class="item-meta"><time>${escapeHtml(formatMonitorTime(entry.timestamp))}</time><strong>${escapeHtml(entry.company)}</strong><span class="kind-badge">${entry.kind === 'insider' ? 'Insider' : '13F'}</span>${entry.url ? `<a class="source-link" href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">↗</a>` : ''}</div>`,
      `<p>${escapeHtml(entry.content)}</p>`,
      '</article>',
    ].join('')),
    '</div>',
    '</section>',
  ].join('\n');
}

function buildMonitorHtml(entries: PortfolioMonitorEntry[], generatedAt = new Date()): string {
  const newsEntries = entries.filter((entry) => entry.kind === 'news');
  const shareholderEntries = entries.filter((entry) => entry.kind === 'insider' || entry.kind === 'institutional');
  const lastUpdated = formatReportVersion(generatedAt);
  return normalizeHtmlReport(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>组合公司监控</title>
  <style>
    :root { color-scheme: light; --text: #111827; --muted: #64748b; --line: #e2e8f0; --bg: #f8fafc; --blue: #174ea6; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrap { min-height: 100vh; padding: 20px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; line-height: 1.25; color: #0b2f6b; letter-spacing: 0; }
    .sub { margin-top: 6px; color: var(--muted); font-size: 12px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.9fr); gap: 16px; align-items: start; }
    .panel { border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: hidden; }
    .panel h2 { margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); color: var(--blue); font-size: 15px; line-height: 1.3; background: #f8fbff; }
    .panel h2 span { margin-left: 6px; color: var(--muted); font-size: 12px; font-weight: 600; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--line); background: #f8fbff; padding-right: 10px; }
    .panel-head h2 { border-bottom: 0; flex: 1; min-width: 0; }
    .item-list { display: grid; gap: 0; }
    .monitor-item { padding: 12px 14px; border-bottom: 1px solid #edf2f7; }
    .monitor-item:last-child { border-bottom: 0; }
    .news-list .monitor-item { display: grid; grid-template-columns: 74px minmax(110px, max-content) minmax(0, 1fr) minmax(80px, max-content) 20px; align-items: baseline; gap: 8px; padding-top: 10px; padding-bottom: 10px; }
    .news-list .monitor-item time { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .news-list .monitor-item strong { color: #0f172a; font-size: 13px; white-space: nowrap; }
    .news-list .monitor-item p { min-width: 0; }
    .news-list .monitor-item em { color: #94a3b8; font-size: 12px; font-style: normal; white-space: nowrap; }
    .item-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 5px; font-size: 12px; color: var(--muted); }
    .item-meta time { font-variant-numeric: tabular-nums; }
    .item-meta strong { color: #0f172a; font-size: 13px; }
    .item-meta em { font-style: normal; color: #94a3b8; }
    .kind-badge { color: #8aa0bd; font-size: 12px; font-weight: 600; }
    .filter-controls { display: inline-flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid #dbe5f2; border-radius: 999px; background: #fff; }
    .filter-controls button { border: 0; border-radius: 999px; background: transparent; color: #64748b; cursor: pointer; font: inherit; font-size: 12px; line-height: 1; padding: 6px 9px; white-space: nowrap; }
    .filter-controls button.active { background: #174ea6; color: #fff; font-weight: 700; }
    .shareholder-panel[data-filter="institutional"] .monitor-item[data-kind="insider"], .shareholder-panel[data-filter="insider"] .monitor-item[data-kind="institutional"] { display: none; }
    .source-link { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; color: #2563eb; text-decoration: none; font-weight: 700; }
    .source-link:hover { background: #eff6ff; }
    p { margin: 0; font-size: 13px; line-height: 1.7; color: #111827; }
    .empty { padding: 22px 14px; color: var(--muted); font-size: 13px; }
    @media (max-width: 980px) { .wrap { padding: 12px; } .grid { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } .news-list .monitor-item { grid-template-columns: 70px minmax(96px, max-content) minmax(0, 1fr) 20px; } .news-list .monitor-item em { display: none; } .panel-head { align-items: flex-start; flex-direction: column; padding: 0 10px 10px 0; } .filter-controls { margin-left: 14px; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>组合公司监控</h1>
        <div class="sub">近 ${MONITOR_RETENTION_DAYS} 天滚动更新 · 最新生成 ${escapeHtml(lastUpdated)} · 新闻 ${newsEntries.length} 条 · 持股变动 ${shareholderEntries.length} 条</div>
      </div>
    </header>
    <main class="grid">
      ${renderNewsColumn(newsEntries, '近 30 天暂无符合条件的公司新闻。')}
      ${renderShareholderColumn(shareholderEntries, '近 30 天暂无符合条件的内部人或机构持股变动。')}
    </main>
  </div>
  <script>
    document.querySelectorAll('[data-filter-button]').forEach(function(button) {
      button.addEventListener('click', function() {
        var panel = button.closest('.shareholder-panel');
        if (!panel) return;
        var filter = button.getAttribute('data-filter-button') || 'all';
        panel.setAttribute('data-filter', filter);
        panel.querySelectorAll('[data-filter-button]').forEach(function(peer) {
          peer.classList.toggle('active', peer === button);
        });
      });
    });
  </script>
</body>
</html>`);
}

function latestEntryTimestamp(entries: PortfolioMonitorEntry[]): string | undefined {
  const times = entries.map((entry) => new Date(entry.timestamp).getTime()).filter((time) => Number.isFinite(time));
  if (!times.length) return undefined;
  return new Date(Math.max(...times)).toISOString();
}

async function upsertPortfolioMonitorFeed(userId: string, incoming: PortfolioMonitorEntry[]) {
  const existing = await prisma.feedItem.findFirst({
    where: { userId, reportKey: MONITOR_REPORT_KEY },
    orderBy: { updatedAt: 'desc' },
  });
  const existingEntries = parseMonitorEntries((existing as any)?.referenceData);
  const entries = mergeMonitorEntries(existingEntries, incoming);
  const now = new Date();
  const referenceData = entries.map((entry, index) => ({
    ...entry,
    refNumber: index + 1,
    ref: `REF${index + 1}`,
  }));
  const data = {
    userId,
    type: 'news',
    category: 'Portfolio Monitor',
    title: `组合公司监控：新闻 ${entries.filter((entry) => entry.kind === 'news').length} / 持股变动 ${entries.filter((entry) => entry.kind !== 'news').length}`,
    content: buildMonitorHtml(entries, now),
    contentFormat: 'html',
    source: 'FMP + public sources',
    tags: normalizeTags(['FMP', 'public-news', 'portfolio-monitor', 'facts-only', 'ownership']),
    reportKey: MONITOR_REPORT_KEY,
    reportVersion: formatReportVersion(now),
    reportType: 'portfolio_fmp_monitor',
    reportTypeLabel: '组合公司监控',
    originalName: '',
    htmlUrl: '',
    referenceData: referenceData.length ? JSON.stringify(referenceData) : '',
    // This is a rolling monitor feed. The feed list should show when the
    // monitor was regenerated; each entry keeps its own source timestamp.
    publishedAt: now,
    pushedAt: now,
    isRead: false,
  } as const;

  if (existing) {
    await prisma.feedItem.update({ where: { id: existing.id }, data });
    await cleanupLegacyPortfolioNewsFeeds(userId, existing.id);
    return { created: false, id: existing.id, total: entries.length };
  }

  const item = await prisma.feedItem.create({ data });
  await cleanupLegacyPortfolioNewsFeeds(userId, item.id);
  return { created: true, id: item.id, total: entries.length };
}

async function cleanupLegacyPortfolioNewsFeeds(userId: string, keepFeedId: string) {
  await prisma.feedItem.deleteMany({
    where: {
      userId,
      id: { not: keepFeedId },
      OR: [
        { reportType: 'portfolio_fmp_news' },
        { reportKey: { startsWith: 'fmp-news:' } },
        { category: 'Portfolio News', tags: { contains: 'portfolio-news' } },
      ],
    },
  });
}

function latestCompletedQuarter(now = new Date()): { year: number; quarter: number } {
  const month = now.getUTCMonth();
  const currentQuarter = Math.floor(month / 3) + 1;
  if (currentQuarter === 1) return { year: now.getUTCFullYear() - 1, quarter: 4 };
  return { year: now.getUTCFullYear(), quarter: currentQuarter - 1 };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function isUsListedCompanyPosition(position: PortfolioSymbol): boolean {
  return isCompanyPosition(position) && /\bUS\s+Equity\b/i.test(position.tickerBbg);
}

function isDirectInsiderTrade(trade: FmpInsiderTradeItem): boolean {
  const type = trade.transactionType || '';
  if (!/^(P-Purchase|S-Sale)$/i.test(type)) return false;
  return Boolean(trade.securitiesTransacted && trade.securitiesTransacted > 0);
}

function buildInsiderMonitorEntry(trade: FmpInsiderTradeItem, position?: PortfolioSymbol): PortfolioMonitorEntry | null {
  if (!isDirectInsiderTrade(trade)) return null;
  const direction = /^P-/i.test(trade.transactionType) ? '买入' : '卖出';
  const shares = formatShares(trade.securitiesTransacted);
  const price = trade.price != null ? `，均价 $${Number(trade.price.toFixed(2))}` : '';
  const owned = trade.securitiesOwned != null ? `，交易后持有 ${formatShares(trade.securitiesOwned)}` : '';
  const role = trade.typeOfOwner ? `（${trade.typeOfOwner}）` : '';
  const content = `${trade.reportingName}${role}${direction}${shares || '股份'}${price}${owned}。`;
  return {
    kind: 'insider',
    dedupeKey: hashKey(['insider', trade.symbol, trade.filingDate, trade.transactionDate, trade.reportingName, trade.transactionType, trade.securitiesTransacted].join('|')),
    timestamp: safeDate(trade.filingDate || trade.transactionDate).toISOString(),
    company: portfolioCompanyDisplayName(position, { symbol: trade.symbol } as FmpStockNewsItem),
    symbol: trade.symbol,
    tickerBbg: position?.tickerBbg || '',
    content,
    url: trade.url || '',
    source: 'SEC Form 4',
    title: `${trade.reportingName} ${trade.transactionType}`,
  };
}

function isMeaningfulInstitutionalChange(item: FmpInstitutionalOwnershipItem): boolean {
  if (!item.investorName) return false;
  const changedShares = item.changeInSharesNumber || 0;
  const changedValue = item.changeInMarketValue || 0;
  return Boolean(item.isNew || item.isSoldOut || Math.abs(changedShares) > 0 || Math.abs(changedValue) > 0);
}

function buildInstitutionalMonitorEntry(item: FmpInstitutionalOwnershipItem, position?: PortfolioSymbol): PortfolioMonitorEntry | null {
  if (!isMeaningfulInstitutionalChange(item)) return null;
  const changeShares = item.changeInSharesNumber || 0;
  const direction = item.isNew ? '新建仓' : item.isSoldOut ? '清仓' : changeShares > 0 ? '增持' : '减持';
  const shares = formatShares(Math.abs(changeShares || item.sharesNumber || 0));
  const current = formatShares(item.sharesNumber);
  const value = formatDollar(item.marketValue);
  const pct = item.changeInSharesNumberPercentage != null && Number.isFinite(item.changeInSharesNumberPercentage)
    ? `，变化 ${Number(item.changeInSharesNumberPercentage.toFixed(1))}%`
    : '';
  const content = `${item.investorName}${direction}${shares || '股份'}${current ? `，期末持有 ${current}` : ''}${value ? `，市值约 ${value}` : ''}${pct}。`;
  return {
    kind: 'institutional',
    dedupeKey: hashKey(['institutional', item.symbol, item.filingDate, item.cik, item.investorName, item.sharesNumber, item.changeInSharesNumber].join('|')),
    timestamp: safeDate(item.filingDate).toISOString(),
    company: portfolioCompanyDisplayName(position, { symbol: item.symbol } as FmpStockNewsItem),
    symbol: item.symbol,
    tickerBbg: position?.tickerBbg || '',
    content,
    url: item.cik ? `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(item.cik)}` : '',
    source: '13F',
    title: `${item.investorName} ${direction}`,
  };
}

async function collectShareholderMonitorEntries(positions: PortfolioSymbol[], warnings: string[]) {
  const shareholderPositions = positions.filter(isUsListedCompanyPosition);
  const bySymbol = new Map(shareholderPositions.map((position) => [position.symbol.toUpperCase(), position]));
  const { year, quarter } = latestCompletedQuarter();
  let fetched = 0;
  let filtered = 0;
  const entries: PortfolioMonitorEntry[] = [];

  await mapLimit(shareholderPositions, 6, async (position) => {
    try {
      const trades = await searchInsiderTrades(position.symbol, { limit: 12 });
      fetched += trades.length;
      for (const trade of trades) {
        const entry = buildInsiderMonitorEntry(trade, bySymbol.get(trade.symbol.toUpperCase()) || position);
        if (entry) entries.push(entry);
        else filtered += 1;
      }
    } catch (error) {
      warnings.push(`FMP insider trades failed for ${position.symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const holders = await getInstitutionalOwnershipBySymbol(position.symbol, { year, quarter, limit: 12 });
      fetched += holders.length;
      for (const holder of holders) {
        const entry = buildInstitutionalMonitorEntry(holder, bySymbol.get(holder.symbol.toUpperCase()) || position);
        if (entry) entries.push(entry);
        else filtered += 1;
      }
    } catch (error) {
      warnings.push(`FMP institutional ownership failed for ${position.symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return { entries, fetched, filtered };
}

async function ingestNews(userId: string, positions: PortfolioSymbol[], warnings: string[]) {
  let fetched = 0;
  let created = 0;
  let skipped = 0;
  let filtered = 0;
  const bySymbol = new Map(positions.map((position) => [position.symbol.toUpperCase(), position]));
  const chunks: PortfolioSymbol[][] = [];
  for (let i = 0; i < positions.length; i += 50) chunks.push(positions.slice(i, i + 50));
  const seenNews = new Set<string>();
  const seenIncludedTitles = new Set<string>();
  const candidates: PortfolioNewsCandidate[] = [];

  for (const chunk of chunks) {
    try {
      const items = await getStockNews(chunk.map((position) => position.symbol), {
        from: isoDateDaysFromNow(-2),
        to: isoDateDaysFromNow(1),
        limit: 100,
      });
      fetched += items.length;
      for (const news of items) {
        const dedupeKey = hashKey([news.symbol, news.publishedAt, news.url, news.title].join('|'));
        if (seenNews.has(dedupeKey)) continue;
        seenNews.add(dedupeKey);
        const position = bySymbol.get(news.symbol.toUpperCase());
        if (!isFactualPortfolioNews(news, position)) {
          filtered += 1;
          continue;
        }
        const titleKey = canonicalTitle(news.title);
        if (titleKey && seenIncludedTitles.has(titleKey)) {
          filtered += 1;
          continue;
        }
        seenIncludedTitles.add(titleKey);
        candidates.push({ news, position, sourceProvider: 'fmp' });
      }
    } catch (error) {
      warnings.push(`FMP news chunk failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const publicNews = await collectPublicPortfolioNews(positions);
    fetched += publicNews.fetched;
    warnings.push(...publicNews.warnings);
    for (const news of publicNews.items) {
      const dedupeKey = hashKey([news.symbol, news.publishedAt, news.url, news.title].join('|'));
      if (seenNews.has(dedupeKey)) continue;
      seenNews.add(dedupeKey);
      const position = bySymbol.get(news.symbol.toUpperCase());
      if (!isFactualPortfolioNews(news, position)) {
        filtered += 1;
        continue;
      }
      const titleKey = canonicalTitle(news.title);
      if (titleKey && seenIncludedTitles.has(titleKey)) {
        filtered += 1;
        continue;
      }
      seenIncludedTitles.add(titleKey);
      candidates.push({ news, position, sourceProvider: 'public' });
    }
  } catch (error) {
    warnings.push(`public news sources failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  candidates.sort((a, b) => {
    const aWeight = a.position?.positionWeight || 0;
    const bWeight = b.position?.positionWeight || 0;
    const aTime = new Date(a.news.publishedAt || '').getTime() || 0;
    const bTime = new Date(b.news.publishedAt || '').getTime() || 0;
    return bWeight - aWeight || factualSourceRank(b.news) - factualSourceRank(a.news) || bTime - aTime;
  });

  const perSymbolCount = new Map<string, number>();
  const includedCandidates: PortfolioNewsCandidate[] = [];
  for (const candidate of candidates) {
    const symbol = candidate.news.symbol || candidate.position?.symbol || 'unknown';
    const count = perSymbolCount.get(symbol) || 0;
    if (count >= 3) {
      filtered += 1;
      continue;
    }
    perSymbolCount.set(symbol, count + 1);
    includedCandidates.push(candidate);
    if (includedCandidates.length >= 80) break;
  }

  const newsEntries = (await Promise.all(includedCandidates.map(buildNewsMonitorEntry))).filter((entry): entry is PortfolioMonitorEntry => {
    if (entry) return true;
    filtered += 1;
    return false;
  });
  const shareholder = await collectShareholderMonitorEntries(positions, warnings);
  fetched += shareholder.fetched;
  filtered += shareholder.filtered;
  const incoming = [...newsEntries, ...shareholder.entries];
  if (!incoming.length) return { fetched, created, skipped, filtered, included: 0, shareholderIncluded: 0 };

  const result = await upsertPortfolioMonitorFeed(userId, incoming);
  if (result.created) created = 1;
  else skipped = 1;

  return {
    fetched,
    created,
    skipped,
    filtered,
    included: newsEntries.length,
    shareholderIncluded: shareholder.entries.length,
    monitorTotal: result.total,
  };
}

function transcriptTitle(position: PortfolioSymbol, transcript: FmpTranscriptItem) {
  const period = transcript.year && transcript.quarter ? `${transcript.year} Q${transcript.quarter}` : (transcript.date || 'Earnings Call');
  return `${position.name} ${period} Earnings Call Transcript`;
}

function buildTranscriptFeedContent(position: PortfolioSymbol, transcriptionId: string, transcript: FmpTranscriptItem) {
  return [
    `**公司**：${position.name}`,
    `**Ticker**：${position.tickerBbg} / ${position.symbol}`,
    `**业绩会**：${transcript.year || '-'} Q${transcript.quarter || '-'} · ${transcript.date || '-'}`,
    `**仓位**：${position.longShort || '/'} · ${(position.positionWeight || 0).toFixed(1)}%`,
    '',
    `已从 FMP 获取 earnings call transcript，并创建 AI Process note：${transcriptionId}。`,
    '系统会在后台生成总结和元数据；如果 summary 暂时为空，稍后刷新 AI Process 即可看到结果。',
  ].join('\n');
}

async function createTranscriptNote(userId: string, position: PortfolioSymbol, transcript: FmpTranscriptItem) {
  const sourceUrl = fmpSourceUrl(position.symbol, transcript.year, transcript.quarter);
  const existing = await prisma.transcription.findFirst({
    where: { userId, filePath: sourceUrl },
    select: { id: true },
  });
  if (existing) return { created: false, id: existing.id };

  const providerKeys = getProviderKeysFromEnv();
  const shouldSummarize = hasSummaryKey(providerKeys);
  const title = transcriptTitle(position, transcript);
  const actualDate = transcript.date ? safeDate(transcript.date) : null;
  const transcription = await prisma.transcription.create({
    data: {
      fileName: title.slice(0, 180),
      filePath: sourceUrl,
      fileSize: Buffer.byteLength(transcript.content, 'utf8'),
      aiProvider: 'text',
      status: shouldSummarize ? 'processing' : 'completed',
      processingStep: shouldSummarize ? 'summarizing' : null,
      transcriptText: transcript.content,
      type: 'note',
      tags: normalizeTags(['FMP', 'earnings-call', position.symbol]),
      organization: position.name,
      participants: 'earnings',
      eventDate: transcript.date || '',
      actualDate,
      userId,
    } as any,
  });

  if (shouldSummarize) {
    const transcriptTextJson = JSON.stringify({ text: transcript.content, segments: [] });
    const customPrompt = [
      '请把这份 earnings call transcript 总结成适合买方投资研究的信息卡。',
      '必须包含：业绩/指引变化、需求变化、毛利率/成本、资本开支、管理层语气、对组合仓位的可能影响。',
      '用中文输出，保留关键英文专有名词。不要编造 transcript 里没有的信息。',
    ].join('\n');
    const metadataFillPrompt = [
      '请输出 JSON 元数据字段：',
      '{"topic":"业绩会主题","organization":"公司名","industry":"行业","country":"国家","participants":"earnings","eventDate":"业绩会日期","speaker":"管理层/公司"}',
    ].join('\n');
    postProcessQueue.enqueue(
      () => performPostProcessing(
        transcription.id,
        transcript.content,
        transcriptTextJson,
        providerKeys.google,
        customPrompt,
        preferredSummaryModel(providerKeys),
        undefined,
        metadataFillPrompt,
        providerKeys,
      ),
      `FMP earnings transcript 后处理: ${transcription.id}`,
      async () => {
        await prisma.transcription.updateMany({
          where: { id: transcription.id, status: 'processing' },
          data: { status: 'failed', errorMessage: 'FMP transcript 后处理超时（10分钟）', processingStep: null },
        }).catch(() => {});
      },
    );
  }

  return { created: true, id: transcription.id };
}

function isRecentTranscript(item: FmpTranscriptDateItem): boolean {
  const date = safeDate(item.date);
  const min = safeDate(isoDateDaysFromNow(-7));
  const max = safeDate(isoDateDaysFromNow(1));
  return date >= min && date <= max;
}

async function ingestTranscripts(userId: string, positions: PortfolioSymbol[], warnings: string[]) {
  let checked = 0;
  let created = 0;
  let skipped = 0;
  const bySymbol = new Map(positions.map((position) => [position.symbol.toUpperCase(), position]));
  let nearSymbols = new Set<string>();

  try {
    const calendar = await getEarningsCalendar(isoDateDaysFromNow(-3), isoDateDaysFromNow(1));
    for (const item of calendar) {
      const symbol = item.symbol.toUpperCase();
      if (bySymbol.has(symbol)) nearSymbols.add(symbol);
    }
  } catch (error) {
    warnings.push(`FMP earnings calendar failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (nearSymbols.size === 0) {
    nearSymbols = new Set(positions.slice(0, 30).map((position) => position.symbol.toUpperCase()));
    warnings.push('FMP earnings calendar did not identify near-term portfolio calls; checked top 30 portfolio symbols for recent transcripts.');
  }

  for (const symbol of nearSymbols) {
    const position = bySymbol.get(symbol);
    if (!position) continue;
    checked += 1;
    try {
      const dates = (await getTranscriptDates(symbol)).filter(isRecentTranscript);
      const latest = dates[0];
      if (!latest?.quarter || !latest.year) {
        skipped += 1;
        continue;
      }
      const transcript = await getEarningCallTranscript(symbol, latest.quarter, latest.year);
      if (!transcript?.content) {
        skipped += 1;
        continue;
      }
      const note = await createTranscriptNote(userId, position, {
        ...transcript,
        date: transcript.date || latest.date,
        quarter: transcript.quarter || latest.quarter,
        year: transcript.year || latest.year,
      });
      if (note.created) {
        created += 1;
        await createFeedIfMissing({
          userId,
          type: 'podcast',
          category: 'Earnings Call Transcript',
          title: transcriptTitle(position, transcript),
          content: buildTranscriptFeedContent(position, note.id, transcript),
          source: 'FMP',
          tags: ['FMP', 'earnings-call', position.symbol, position.sectorName].filter(Boolean),
          reportKey: `fmp-transcript:${position.symbol}:${latest.year}:Q${latest.quarter}`,
          reportType: 'fmp_earnings_transcript',
          reportTypeLabel: '业绩会 Transcript',
          publishedAt: transcript.date || latest.date,
          referenceData: [{
            refNumber: 1,
            ref: 'REF1',
            id: note.id,
            title: transcriptTitle(position, transcript),
            organization: position.name,
            date: transcript.date || latest.date,
            sourceType: 'transcription',
          }],
        });
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;
      warnings.push(`FMP transcript failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { checked, created, skipped };
}

export async function runFmpPortfolioIngest(userId: string, mode: FmpIngestMode = 'all'): Promise<FmpIngestResult> {
  if (!hasFmpApiKey()) {
    const err = new Error('FMP_API_KEY is not configured');
    (err as any).status = 500;
    throw err;
  }

  const positions = await loadPortfolioSymbols(userId);
  const warnings: string[] = [];
  const result: FmpIngestResult = {
    mode,
    userId,
    symbols: positions.length,
    news: { fetched: 0, created: 0, skipped: 0, filtered: 0, included: 0 },
    transcripts: { checked: 0, created: 0, skipped: 0 },
    warnings,
  };

  if (mode === 'news' || mode === 'all') {
    result.news = await ingestNews(userId, positions, warnings);
  }
  if (mode === 'transcripts' || mode === 'all') {
    result.transcripts = await ingestTranscripts(userId, positions, warnings);
  }
  return result;
}
