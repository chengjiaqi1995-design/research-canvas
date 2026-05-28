import axios from 'axios';
import type { FmpStockNewsItem } from './fmpService';

export type PublicNewsSource =
  | 'GDELT'
  | 'Google News'
  | 'PR Newswire'
  | 'GlobeNewswire'
  | 'SEC EDGAR'
  | 'CNINFO'
  | 'HKEXnews';

export type PublicPortfolioPosition = {
  symbol: string;
  tickerBbg: string;
  name: string;
  nameEn: string;
  nameCn: string;
  positionWeight: number;
  sectorName: string;
};

export type PublicNewsResult = {
  items: FmpStockNewsItem[];
  fetched: number;
  warnings: string[];
};

type RawNewsCandidate = {
  source: PublicNewsSource;
  title: string;
  text: string;
  site: string;
  url: string;
  sourceUrl?: string;
  publishedAt: string;
  position?: PublicPortfolioPosition;
};

type CninfoStock = {
  code: string;
  orgId: string;
  zwjc?: string;
};

type HkexStock = {
  i: number;
  c: string;
  n: string;
};

const PUBLIC_NEWS_TIMEOUT_MS = Number(process.env.PUBLIC_NEWS_TIMEOUT_MS || 8000);
const PUBLIC_NEWS_DAYS = Math.min(Math.max(Number(process.env.PUBLIC_NEWS_DAYS || 7), 1), 30);
// Google News is noisy for portfolio monitoring: it is an aggregator, often
// re-surfaces stale syndicated articles, and loses clean source provenance.
// Keep it opt-in only for manual/backfill experiments.
const PUBLIC_NEWS_GOOGLE_LIMIT = Math.min(Math.max(Number(process.env.PUBLIC_NEWS_GOOGLE_LIMIT || 0), 0), 260);
const PUBLIC_NEWS_GDELT_LIMIT = Math.min(Math.max(Number(process.env.PUBLIC_NEWS_GDELT_LIMIT || 220), 0), 260);
const PUBLIC_NEWS_GDELT_TIMEOUT_MS = Math.min(Math.max(Number(process.env.PUBLIC_NEWS_GDELT_TIMEOUT_MS || 4000), 1000), 15000);
const PUBLIC_NEWS_GDELT_CONCURRENCY = Math.min(Math.max(Number(process.env.PUBLIC_NEWS_GDELT_CONCURRENCY || 4), 1), 8);
const PUBLIC_NEWS_GDELT_CHUNK_SIZE = Math.min(Math.max(Number(process.env.PUBLIC_NEWS_GDELT_CHUNK_SIZE || 4), 1), 8);
const PUBLIC_NEWS_SEC_LIMIT = Math.min(Math.max(Number(process.env.PUBLIC_NEWS_SEC_LIMIT || 220), 0), 260);
const GOOGLE_NEWS_DECODE_MAX_BYTES = Math.max(500_000, Number(process.env.GOOGLE_NEWS_DECODE_MAX_BYTES || 5_000_000));

const USER_AGENT = process.env.PUBLIC_NEWS_USER_AGENT
  || process.env.SEC_USER_AGENT
  || 'ResearchCanvas portfolio monitor jiaqi@example.com';

const GENERIC_COMPANY_TERMS = new Set([
  'ord',
  'class',
  'company',
  'corp',
  'corporation',
  'inc',
  'ltd',
  'limited',
  'plc',
  'group',
  'holdings',
  'holding',
  'international',
  'technology',
  'technologies',
  'energy',
  'systems',
  'global',
  'venture',
  'common',
  'stock',
  'equity',
  'first',
  'general',
  'american',
  'national',
]);

const CORPORATE_COMPANY_TERMS = new Set([
  'ord',
  'class',
  'company',
  'corp',
  'corporation',
  'inc',
  'ltd',
  'limited',
  'plc',
  'group',
  'holdings',
  'holding',
  'common',
  'stock',
  'equity',
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

const LOW_VALUE_OFFICIAL_PATTERNS = [
  /monthly return/i,
  /next day disclosure return/i,
  /trading information of exchange traded funds/i,
  /overseas regulatory announcement\s*-\s*other/i,
  /list of directors and their role/i,
  /terms of reference/i,
  /proxy form/i,
  /form of proxy/i,
  /poll results/i,
  /change of address/i,
  /公告格式|代理人委任表格|代表委任表格|月报表|翌日披露报表|董事名单与其角色和职能|职权范围/,
];

const FACTUAL_TITLE_PATTERNS = [
  /earnings|financial results|revenue|profit|eps|guidance|outlook|dividend|buyback|repurchase/i,
  /contract|order|backlog|delivery|shipment|customer|partnership|agreement|supply/i,
  /acquisition|merger|divest|joint venture|investment|financing|offering|loan|credit facility/i,
  /approval|regulatory|investigation|lawsuit|settlement|recall|permit|sanction|penalty/i,
  /factory|plant|capacity|production|project|facility|mine|drilling|reserve/i,
  /ceo|cfo|chairman|appoint|resign|management|board|director/i,
  /\b(8-k|10-q|10-k|20-f|6-k)\b/i,
  /业绩|收入|利润|指引|订单|合同|中标|交付|客户|合作|并购|收购|融资|回购|分红|产能|投产|项目|监管|处罚|诉讼|召回|减持|增持|权益变动|董事|高管|管理层|公告/,
];

const WIRE_LOW_VALUE_PATTERNS = [
  /\b(to report|will report|plans? to report|scheduled to report|announces? date).{0,60}\b(financial results|quarterly results|earnings)\b/i,
  /\b(conference call|webcast|investor conference|fireside chat|presentation|roadshow|webinar|expo|trade show)\b/i,
  /\b(participat(?:e|es|ing) in|present(?:s|ing)? at|to host|will host|invited to)\b/i,
  /\b(awards?|recognized|recognition|ranked|named).{0,80}\b(best|top|leader|employer|workplace|innovation|sustainability)\b/i,
  /\b(esg|sustainability|carbon neutral|net zero|diversity|charity|donation|sponsor(?:ship)?|community)\b/i,
  /\b(certification|certified|certificate|efqm|zertifizierung)\b/i,
  /\b(groundbreaking ceremony|ribbon cutting|grand opening|opens?.{0,30}pre-orders?|launches? website)\b/i,
];

const WIRE_MATERIAL_PATTERNS = [
  /\b(revenue|revenues|sales|profit|net income|eps|guidance|outlook|financial results|quarterly results|annual results)\b/i,
  /\b(contract|order|backlog|customer agreement|supply agreement|commercial agreement|purchase agreement|awarded? .{0,40}contract)\b/i,
  /\b(acquisition|merger|divest|joint venture|strategic investment|investment|financing|offering|loan|credit facility|debt|bond|capital raise)\b/i,
  /\b(factory|plant|capacity|production|shipment|delivery|project|facility|mine|drilling|reserve|restart|outage)\b/i,
  /\b(approval|regulatory|investigation|lawsuit|settlement|recall|permit|sanction|penalty|fine)\b/i,
  /\b(dividend|buyback|repurchase)\b/i,
  /\b(ceo|cfo|chairman|appoint|appointed|resign|resigned|management change|board change|director)\b/i,
  /业绩|收入|利润|指引|订单|合同|中标|交付|客户协议|供货协议|并购|收购|融资|回购|分红|产能|投产|项目|监管|处罚|诉讼|召回|减持|增持|权益变动|董事|高管|管理层/,
];

let cninfoStockListPromise: Promise<Map<string, CninfoStock>> | null = null;
let hkexStockListPromise: Promise<Map<string, HkexStock>> | null = null;
let secTickerMapPromise: Promise<Map<string, { cik: number; title: string }>> | null = null;

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function compactText(value = '', maxLength = 800): string {
  const text = stripHtml(value).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function decodeXml(value = ''): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value = ''): string {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
}

function pickXmlAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function parseRssOrAtom(xml: string, source: PublicNewsSource, defaultSite: string): RawNewsCandidate[] {
  const blocks = [
    ...Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((match) => match[0]),
    ...Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)).map((match) => match[0]),
  ];
  return blocks
    .map((block): RawNewsCandidate | null => {
      const title = pickXmlTag(block, 'title');
      const rssLink = pickXmlTag(block, 'link');
      const atomLink = pickXmlAttr(block, 'link', 'href');
      const url = rssLink || atomLink || pickXmlTag(block, 'guid');
      const publishedAt = pickXmlTag(block, 'pubDate') || pickXmlTag(block, 'published') || pickXmlTag(block, 'updated') || '';
      const sourceName = pickXmlTag(block, 'source') || defaultSite;
      const sourceUrl = pickXmlAttr(block, 'source', 'url');
      const text = [
        pickXmlTag(block, 'description'),
        pickXmlTag(block, 'summary'),
        pickXmlTag(block, 'encoded'),
      ].filter(Boolean).join(' ');
      if (!title || !url) return null;
      return {
        source,
        title,
        text: compactText(text, 1600),
        site: sourceName || defaultSite,
        url,
        sourceUrl: sourceUrl || undefined,
        publishedAt: normalizeDate(publishedAt),
      };
    })
    .filter((item): item is RawNewsCandidate => item !== null);
}

function normalizeDate(value?: string): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTickerCode(tickerBbg = ''): { code: string; suffix: string } {
  const cleaned = tickerBbg.replace(/\s+Equity$/i, '').trim();
  const parts = cleaned.split(/\s+/);
  return { code: (parts[0] || '').toUpperCase(), suffix: (parts[1] || '').toUpperCase() };
}

function isCompanyLikePosition(position: PublicPortfolioPosition): boolean {
  const haystack = `${position.nameEn} ${position.nameCn} ${position.name} ${position.tickerBbg}`;
  return !/\b(ETF|TRUST|FUND|SPDR|ISHARES|XTRCKR|S&P\s*500|CSI\s*300|SELECT SECTOR)\b/i.test(haystack);
}

function englishTokens(value = ''): string[] {
  return value
    .toLowerCase()
    .replace(/\b(equity|ord|common|stock|class)\b/g, ' ')
    .replace(/\bcl\s+[a-z]\b/g, ' ')
    .replace(/-w\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_COMPANY_TERMS.has(token));
}

function englishNamePhraseTokens(value = ''): string[] {
  return value
    .toLowerCase()
    .replace(/\b(equity|ord|common|stock|class)\b/g, ' ')
    .replace(/\bcl\s+[a-z]\b/g, ' ')
    .replace(/-w\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !CORPORATE_COMPANY_TERMS.has(token));
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

function canLeadingTokenStandAlone(rawTokens: string[], token: string): boolean {
  if (rawTokens.length < 2) return true;
  return token === rawTokens[0] && token.length >= 8 && !AMBIGUOUS_LEADING_COMPANY_TOKENS.has(token);
}

function cleanCompanyName(value = ''): string {
  return value
    .replace(/\s+ORD(?:\s+[A-Z])?$/i, '')
    .replace(/\s+CL\s+[A-Z]$/i, '')
    .replace(/\s+COMMON\s+STOCK$/i, '')
    .replace(/\s+SPON(?:SORED)?\s+ADR.*$/i, ' ADR')
    .replace(/\s+ADR\s+EACH.*$/i, ' ADR')
    .replace(/-W$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function positionSearchNames(position: PublicPortfolioPosition): string[] {
  const { code, suffix } = normalizeTickerCode(position.tickerBbg);
  const names = [
    cleanCompanyName(position.nameEn),
    cleanCompanyName(position.name),
    position.nameCn,
  ];
  if (/^[A-Z0-9.-]{2,8}$/.test(code) && !/^\d+$/.test(code) && !['F', 'VG'].includes(code)) names.push(code);
  if (suffix === 'HK' && /^\d+$/.test(code)) names.push(code.padStart(4, '0'), code.padStart(5, '0'));
  if (['CH', 'CG', 'CS', 'CN', 'SS', 'SZ'].includes(suffix) && /^\d{6}$/.test(code)) names.push(code);
  return Array.from(new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2))).slice(0, 5);
}

function matchesCandidateToPosition(candidate: RawNewsCandidate, position: PublicPortfolioPosition): boolean {
  const haystack = `${candidate.title}\n${candidate.text}\n${candidate.url}`.toLowerCase();
  const chineseName = (position.nameCn || '').trim();
  if (chineseName && chineseName.length >= 2 && haystack.includes(chineseName.toLowerCase())) return true;

  const englishName = cleanCompanyName(position.nameEn || position.name || '');
  const rawPhraseTokens = englishNamePhraseTokens(englishName);
  if (rawPhraseTokens.length >= 2 && containsEnglishPhrase(haystack, rawPhraseTokens.slice(0, 2).join(' '))) return true;

  const phraseTokens = englishTokens(englishName);
  if (phraseTokens.length >= 2 && containsEnglishPhrase(haystack, phraseTokens.slice(0, 2).join(' '))) return true;

  const tokens = phraseTokens.filter((token) => token.length >= 4).slice(0, 6);
  if (tokens.length === 1) {
    if (!canLeadingTokenStandAlone(rawPhraseTokens, tokens[0])) return false;
    return tokens[0] === phraseTokens[0] && containsEnglishToken(haystack, tokens[0]);
  }
  if (tokens.length > 1) {
    const matched = tokens.filter((token) => containsEnglishToken(haystack, token));
    if (matched.length >= 2) return true;
    if (canLeadingTokenStandAlone(rawPhraseTokens, tokens[0]) && containsEnglishToken(haystack, tokens[0])) return true;
  }

  const { code, suffix } = normalizeTickerCode(position.tickerBbg);
  if (/^[A-Z0-9.-]{2,8}$/.test(code) && ['US', 'UQ', 'UN', 'UW'].includes(suffix)) {
    return new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(haystack);
  }
  return false;
}

function matchCandidate(candidate: RawNewsCandidate, positions: PublicPortfolioPosition[]): PublicPortfolioPosition | undefined {
  if (candidate.position) return candidate.position;
  return positions.find((position) => matchesCandidateToPosition(candidate, position));
}

function isUsefulPublicCandidate(candidate: RawNewsCandidate): boolean {
  const haystack = `${candidate.title}\n${candidate.text}\n${candidate.site}\n${candidate.url}`;
  if (LOW_VALUE_OFFICIAL_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
  if (isWireCandidate(candidate)) {
    if (WIRE_LOW_VALUE_PATTERNS.some((pattern) => pattern.test(haystack))) return false;
    return WIRE_MATERIAL_PATTERNS.some((pattern) => pattern.test(haystack));
  }
  return FACTUAL_TITLE_PATTERNS.some((pattern) => pattern.test(haystack));
}

function isWireCandidate(candidate: RawNewsCandidate): boolean {
  const source = `${candidate.source}\n${candidate.site}\n${candidate.url}`;
  return /prnewswire|globenewswire|businesswire/i.test(source);
}

function googleNewsArticleId(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const index = parts.lastIndexOf('articles');
    if (!/news\.google\.com$/i.test(parsed.hostname) || index < 0 || !parts[index + 1]) return '';
    return parts[index + 1];
  } catch {
    return '';
  }
}

const googleNewsDecodeCache = new Map<string, Promise<string>>();

async function decodeGoogleNewsUrl(url: string): Promise<string> {
  const id = googleNewsArticleId(url);
  if (!id) return url;
  if (!googleNewsDecodeCache.has(id)) {
    googleNewsDecodeCache.set(id, (async () => {
      const articlePage = await axios.get<string>(`https://news.google.com/articles/${encodeURIComponent(id)}`, {
        timeout: PUBLIC_NEWS_TIMEOUT_MS,
        responseType: 'text',
        maxContentLength: GOOGLE_NEWS_DECODE_MAX_BYTES,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const signature = String(articlePage.data || '').match(/data-n-a-sg="([^"]+)"/)?.[1];
      const timestamp = String(articlePage.data || '').match(/data-n-a-ts="([^"]+)"/)?.[1];
      if (!signature || !timestamp) return url;

      const articlesReq = [
        'Fbv4je',
        `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`,
      ];
      const response = await axios.post<string>(
        'https://news.google.com/_/DotsSplashUi/data/batchexecute',
        new URLSearchParams({ 'f.req': JSON.stringify([[articlesReq]]) }).toString(),
        {
          timeout: PUBLIC_NEWS_TIMEOUT_MS,
          responseType: 'text',
          maxContentLength: GOOGLE_NEWS_DECODE_MAX_BYTES,
          headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://news.google.com/',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
        },
      );
      const line = String(response.data || '').split('\n').find((row) => row.includes('Fbv4je')) || '';
      if (!line) return url;
      try {
        const outer = JSON.parse(line);
        const payload = outer?.[0]?.[2];
        const inner = payload ? JSON.parse(payload) : null;
        const decoded = typeof inner?.[1] === 'string' ? inner[1] : '';
        return /^https?:\/\//i.test(decoded) ? decoded : url;
      } catch {
        return url;
      }
    })());
  }
  return googleNewsDecodeCache.get(id)!;
}

async function decodeGoogleCandidates(candidates: RawNewsCandidate[], warnings: string[]): Promise<RawNewsCandidate[]> {
  const decoded = await mapLimit(candidates, 2, async (candidate) => {
    if (candidate.source !== 'Google News' || !googleNewsArticleId(candidate.url)) return candidate;
    try {
      const decodedUrl = await decodeGoogleNewsUrl(candidate.url);
      if (/^https:\/\/news\.google\.com\//i.test(decodedUrl)) return null;
      return { ...candidate, url: decodedUrl };
    } catch (error) {
      warnings.push(`Google News link decode failed for ${candidate.title}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
  return decoded.filter((candidate): candidate is RawNewsCandidate => candidate !== null);
}

function toFmpNews(candidate: RawNewsCandidate, position: PublicPortfolioPosition): FmpStockNewsItem {
  return {
    symbol: position.symbol,
    title: candidate.title,
    text: candidate.text,
    site: candidate.site || candidate.source,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
  };
}

async function fetchText(url: string, source: PublicNewsSource): Promise<string> {
  const response = await axios.get<string>(url, {
    timeout: PUBLIC_NEWS_TIMEOUT_MS,
    responseType: 'text',
    maxContentLength: 1_500_000,
    maxRedirects: 3,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,text/html,application/json;q=0.9,*/*;q=0.8',
      ...(source === 'CNINFO' ? { Referer: 'http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice', 'X-Requested-With': 'XMLHttpRequest' } : {}),
    },
  });
  return String(response.data || '');
}

async function collectRssNews(positions: PublicPortfolioPosition[], warnings: string[]): Promise<{ items: RawNewsCandidate[]; fetched: number }> {
  const feeds: Array<{ source: PublicNewsSource; site: string; url: string }> = [
    { source: 'PR Newswire', site: 'prnewswire.com', url: 'https://www.prnewswire.com/rss/news-releases-list.rss' },
    { source: 'GlobeNewswire', site: 'globenewswire.com', url: 'https://www.globenewswire.com/rssfeed/orgclass/1-Public%20Companies' },
    { source: 'GlobeNewswire', site: 'globenewswire.com', url: 'https://www.globenewswire.com/rssfeed/subjectcode/4-earnings%20releases%20and%20operating%20results' },
  ];
  const items: RawNewsCandidate[] = [];
  let fetched = 0;
  await Promise.all(feeds.map(async (feed) => {
    try {
      const xml = await fetchText(feed.url, feed.source);
      const parsed = parseRssOrAtom(xml, feed.source, feed.site);
      fetched += parsed.length;
      for (const candidate of parsed) {
        const position = matchCandidate(candidate, positions);
        if (position) items.push({ ...candidate, position });
      }
    } catch (error) {
      warnings.push(`${feed.source} feed failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  return { items, fetched };
}

function googleQueryForPosition(position: PublicPortfolioPosition): string {
  const names = positionSearchNames(position).slice(0, 3);
  const query = names.map((name) => `"${name.replace(/"/g, '')}"`).join(' OR ');
  return `${query || `"${position.symbol}"`} when:${PUBLIC_NEWS_DAYS}d`;
}

async function collectGoogleNews(positions: PublicPortfolioPosition[], warnings: string[]): Promise<{ items: RawNewsCandidate[]; fetched: number }> {
  if (PUBLIC_NEWS_GOOGLE_LIMIT <= 0) return { items: [], fetched: 0 };
  const selected = positions
    .filter(isCompanyLikePosition)
    .sort((a, b) => (b.positionWeight || 0) - (a.positionWeight || 0))
    .slice(0, PUBLIC_NEWS_GOOGLE_LIMIT);
  const items: RawNewsCandidate[] = [];
  let fetched = 0;
  await mapLimit(selected, 5, async (position) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(googleQueryForPosition(position))}&hl=en-US&gl=US&ceid=US:en`;
      const xml = await fetchText(url, 'Google News');
      const parsed = parseRssOrAtom(xml, 'Google News', 'news.google.com')
        .filter((candidate) => matchesCandidateToPosition(candidate, position))
        .slice(0, 3)
        .map((candidate) => ({ ...candidate, position }));
      fetched += parsed.length;
      items.push(...await decodeGoogleCandidates(parsed, warnings));
    } catch (error) {
      warnings.push(`Google News failed for ${position.tickerBbg}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { items, fetched };
}

function gdeltQueryTerm(position: PublicPortfolioPosition): string {
  const names = positionSearchNames(position)
    .filter((name) => !/^\d+$/.test(name))
    .slice(0, 2);
  return names.length ? names.map((name) => `"${name.replace(/"/g, '')}"`).join(' OR ') : `"${position.symbol}"`;
}

async function collectGdeltNews(positions: PublicPortfolioPosition[], warnings: string[]): Promise<{ items: RawNewsCandidate[]; fetched: number }> {
  if (PUBLIC_NEWS_GDELT_LIMIT <= 0) return { items: [], fetched: 0 };
  const selected = positions
    .filter(isCompanyLikePosition)
    .sort((a, b) => (b.positionWeight || 0) - (a.positionWeight || 0))
    .slice(0, PUBLIC_NEWS_GDELT_LIMIT);
  const chunks: PublicPortfolioPosition[][] = [];
  for (let i = 0; i < selected.length; i += PUBLIC_NEWS_GDELT_CHUNK_SIZE) chunks.push(selected.slice(i, i + PUBLIC_NEWS_GDELT_CHUNK_SIZE));

  const items: RawNewsCandidate[] = [];
  let fetched = 0;
  let failureCount = 0;
  let firstFailure = '';
  await mapLimit(chunks, PUBLIC_NEWS_GDELT_CONCURRENCY, async (chunk) => {
    const query = chunk.map(gdeltQueryTerm).filter(Boolean).join(' OR ');
    if (!query) return;
    try {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`(${query})`)}&mode=artlist&format=json&timespan=${PUBLIC_NEWS_DAYS}d&maxrecords=100&sort=hybridrel`;
      const response = await axios.get(url, {
        timeout: PUBLIC_NEWS_GDELT_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/plain,*/*' },
      });
      const articles = Array.isArray(response.data?.articles) ? response.data.articles : [];
      fetched += articles.length;
      for (const article of articles) {
        const candidate: RawNewsCandidate = {
          source: 'GDELT',
          title: String(article.title || ''),
          text: String(article.seendate || article.socialimage || ''),
          site: String(article.domain || 'gdeltproject.org'),
          url: String(article.url || ''),
          publishedAt: normalizeDate(String(article.seendate || '')),
        };
        if (!candidate.title || !candidate.url) continue;
        const position = matchCandidate(candidate, chunk);
        if (position) items.push({ ...candidate, position });
      }
    } catch (error) {
      failureCount += 1;
      if (!firstFailure) firstFailure = error instanceof Error ? error.message : String(error);
    }
  });
  if (failureCount > 0) warnings.push(`GDELT failed for ${failureCount} chunk(s): ${firstFailure}`);
  return { items, fetched };
}

async function getSecTickerMap(): Promise<Map<string, { cik: number; title: string }>> {
  if (!secTickerMapPromise) {
    secTickerMapPromise = (async () => {
      const response = await axios.get('https://www.sec.gov/files/company_tickers.json', {
        timeout: PUBLIC_NEWS_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      const map = new Map<string, { cik: number; title: string }>();
      for (const item of Object.values(response.data || {}) as Array<{ cik_str?: number; ticker?: string; title?: string }>) {
        const ticker = String(item.ticker || '').toUpperCase();
        if (!ticker || !item.cik_str) continue;
        map.set(ticker.replace(/\./g, '-'), { cik: item.cik_str, title: String(item.title || '') });
      }
      return map;
    })();
  }
  return secTickerMapPromise;
}

function secFilingUrl(cik: number, accessionNumber: string, primaryDocument: string): string {
  const cikPath = String(cik);
  const accessionPath = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikPath}/${accessionPath}/${primaryDocument}`;
}

async function collectSecNews(positions: PublicPortfolioPosition[], warnings: string[]): Promise<{ items: RawNewsCandidate[]; fetched: number }> {
  if (PUBLIC_NEWS_SEC_LIMIT <= 0) return { items: [], fetched: 0 };
  let tickerMap: Map<string, { cik: number; title: string }>;
  try {
    tickerMap = await getSecTickerMap();
  } catch (error) {
    warnings.push(`SEC ticker map failed: ${error instanceof Error ? error.message : String(error)}`);
    return { items: [], fetched: 0 };
  }

  const cutoff = Date.now() - PUBLIC_NEWS_DAYS * 24 * 60 * 60 * 1000;
  const selected = positions
    .filter((position) => isCompanyLikePosition(position) && /\bUS\s+Equity\b/i.test(position.tickerBbg))
    .sort((a, b) => (b.positionWeight || 0) - (a.positionWeight || 0))
    .slice(0, PUBLIC_NEWS_SEC_LIMIT);
  const items: RawNewsCandidate[] = [];
  let fetched = 0;
  await mapLimit(selected, 4, async (position) => {
    const { code } = normalizeTickerCode(position.tickerBbg);
    const sec = tickerMap.get(code.replace(/\./g, '-'));
    if (!sec) return;
    try {
      const cik = String(sec.cik).padStart(10, '0');
      const response = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        timeout: PUBLIC_NEWS_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      const recent = response.data?.filings?.recent || {};
      const forms: string[] = Array.isArray(recent.form) ? recent.form : [];
      const filingDates: string[] = Array.isArray(recent.filingDate) ? recent.filingDate : [];
      const reportDates: string[] = Array.isArray(recent.reportDate) ? recent.reportDate : [];
      const accessions: string[] = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
      const documents: string[] = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
      const descriptions: string[] = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription : [];
      for (let i = 0; i < Math.min(forms.length, 80); i += 1) {
        const form = String(forms[i] || '').toUpperCase();
        if (!['8-K', '10-Q', '10-K', '10-Q/A', '10-K/A', '20-F', '6-K'].includes(form)) continue;
        const publishedAt = normalizeDate(filingDates[i]);
        if (new Date(publishedAt).getTime() < cutoff) continue;
        const description = descriptions[i] || reportDates[i] || form;
        const url = accessions[i] && documents[i] ? secFilingUrl(sec.cik, accessions[i], documents[i]) : `https://www.sec.gov/edgar/browse/?CIK=${sec.cik}`;
        items.push({
          source: 'SEC EDGAR',
          title: `${cleanCompanyName(position.nameEn || position.name)} filed SEC ${form}`,
          text: `SEC ${form}${description ? `: ${description}` : ''}${reportDates[i] ? `; report date ${reportDates[i]}` : ''}`,
          site: 'sec.gov',
          url,
          publishedAt,
          position,
        });
        fetched += 1;
      }
    } catch (error) {
      warnings.push(`SEC filings failed for ${position.tickerBbg}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { items, fetched };
}

async function getCninfoStockMap(): Promise<Map<string, CninfoStock>> {
  if (!cninfoStockListPromise) {
    cninfoStockListPromise = (async () => {
      const text = await fetchText('http://www.cninfo.com.cn/new/data/szse_stock.json', 'CNINFO');
      const data = JSON.parse(text);
      const map = new Map<string, CninfoStock>();
      for (const item of (data.stockList || []) as CninfoStock[]) {
        if (item.code && item.orgId) map.set(item.code, item);
      }
      return map;
    })();
  }
  return cninfoStockListPromise;
}

function cninfoCode(position: PublicPortfolioPosition): string {
  const { code, suffix } = normalizeTickerCode(position.tickerBbg);
  if (!['CH', 'CG', 'CS', 'CN', 'SS', 'SH', 'SZ', 'SHE', 'SHG'].includes(suffix)) return '';
  return /^\d{6}$/.test(code) ? code : '';
}

async function collectCninfoNews(positions: PublicPortfolioPosition[], warnings: string[]): Promise<{ items: RawNewsCandidate[]; fetched: number }> {
  let stockMap: Map<string, CninfoStock>;
  try {
    stockMap = await getCninfoStockMap();
  } catch (error) {
    warnings.push(`CNINFO stock list failed: ${error instanceof Error ? error.message : String(error)}`);
    return { items: [], fetched: 0 };
  }
  const cnPositions = positions.filter((position) => cninfoCode(position));
  const items: RawNewsCandidate[] = [];
  let fetched = 0;
  const seDate = `${isoDateDaysAgo(PUBLIC_NEWS_DAYS)}~${isoDateDaysAgo(0)}`;

  await mapLimit(cnPositions, 4, async (position) => {
    const code = cninfoCode(position);
    const meta = stockMap.get(code);
    if (!meta) return;
    const isShanghai = code.startsWith('6') || code.startsWith('9');
    try {
      const params = new URLSearchParams({
        stock: `${code},${meta.orgId}`,
        searchkey: '',
        plate: isShanghai ? 'sh' : 'sz',
        category: '',
        trade: '',
        column: isShanghai ? 'sse' : 'szse',
        pageNum: '1',
        pageSize: '20',
        tabName: 'fulltext',
        sortName: '',
        sortType: '',
        limit: '',
        showTitle: '',
        seDate,
        isHLtitle: 'true',
      });
      const response = await axios.post('http://www.cninfo.com.cn/new/hisAnnouncement/query', params, {
        timeout: PUBLIC_NEWS_TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT,
          Referer: 'http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
      });
      const announcements = Array.isArray(response.data?.announcements) ? response.data.announcements : [];
      fetched += announcements.length;
      for (const ann of announcements) {
        const title = stripHtml(String(ann.announcementTitle || ''));
        if (!title || LOW_VALUE_OFFICIAL_PATTERNS.some((pattern) => pattern.test(title))) continue;
        const secName = stripHtml(String(ann.secName || meta.zwjc || position.nameCn || position.nameEn));
        const adjunctUrl = String(ann.adjunctUrl || '');
        const rawTime = ann.announcementTime ? new Date(Number(ann.announcementTime)).toISOString() : undefined;
        items.push({
          source: 'CNINFO',
          title: `${secName}：${title}`,
          text: `${secName} ${title}`,
          site: 'cninfo.com.cn',
          url: adjunctUrl ? `https://static.cninfo.com.cn/${adjunctUrl.replace(/^\/+/, '')}` : 'https://www.cninfo.com.cn/',
          publishedAt: normalizeDate(rawTime),
          position,
        });
      }
    } catch (error) {
      warnings.push(`CNINFO failed for ${position.tickerBbg}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { items, fetched };
}

async function getHkexStockMap(): Promise<Map<string, HkexStock>> {
  if (!hkexStockListPromise) {
    hkexStockListPromise = (async () => {
      const response = await axios.get<HkexStock[]>('https://www1.hkexnews.hk/ncms/script/eds/activestock_sehk_e.json', {
        timeout: PUBLIC_NEWS_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/plain,*/*' },
      });
      const map = new Map<string, HkexStock>();
      for (const stock of response.data || []) {
        if (stock.c && stock.i) map.set(stock.c, stock);
      }
      return map;
    })();
  }
  return hkexStockListPromise;
}

function hkexCode(position: PublicPortfolioPosition): string {
  const { code, suffix } = normalizeTickerCode(position.tickerBbg);
  if (suffix !== 'HK' && suffix !== 'HKEX') return '';
  return /^\d+$/.test(code) ? code.padStart(5, '0') : '';
}

function parseHkexDate(value = ''): string {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return normalizeDate(value);
  const [, dd, mm, yyyy, hh = '12', min = '00'] = match;
  return normalizeDate(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+08:00`);
}

async function collectHkexNews(positions: PublicPortfolioPosition[], warnings: string[]): Promise<{ items: RawNewsCandidate[]; fetched: number }> {
  let stockMap: Map<string, HkexStock>;
  try {
    stockMap = await getHkexStockMap();
  } catch (error) {
    warnings.push(`HKEX stock list failed: ${error instanceof Error ? error.message : String(error)}`);
    return { items: [], fetched: 0 };
  }

  const hkPositions = positions.filter((position) => hkexCode(position));
  const fromDate = isoDateDaysAgo(PUBLIC_NEWS_DAYS).replace(/-/g, '');
  const toDate = isoDateDaysAgo(0).replace(/-/g, '');
  const items: RawNewsCandidate[] = [];
  let fetched = 0;

  await mapLimit(hkPositions, 4, async (position) => {
    const code = hkexCode(position);
    const meta = stockMap.get(code);
    if (!meta) return;
    try {
      const response = await axios.get('https://www1.hkexnews.hk/search/titleSearchServlet.do', {
        timeout: PUBLIC_NEWS_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/plain,*/*' },
        params: {
          sortDir: 0,
          sortByOptions: 'DateTime',
          category: 0,
          market: 'SEHK',
          stockId: meta.i,
          documentType: -1,
          fromDate,
          toDate,
          title: '',
          searchType: 1,
          t1code: -2,
          t2Gcode: -2,
          t2code: -2,
          rowRange: 40,
          lang: 'EN',
        },
      });
      const rawResult = typeof response.data?.result === 'string' ? JSON.parse(response.data.result) : [];
      const rows = Array.isArray(rawResult) ? rawResult : [];
      fetched += rows.length;
      for (const row of rows) {
        const headline = stripHtml(String(row.SHORT_TEXT || row.LONG_TEXT || row.TITLE || ''));
        if (!headline || LOW_VALUE_OFFICIAL_PATTERNS.some((pattern) => pattern.test(headline))) continue;
        const stockName = stripHtml(String(row.STOCK_NAME || meta.n || position.nameEn));
        const fileLink = String(row.FILE_LINK || '');
        items.push({
          source: 'HKEXnews',
          title: `${stockName}：${headline}`,
          text: `${stockName} ${headline} ${stripHtml(String(row.LONG_TEXT || ''))}`,
          site: 'hkexnews.hk',
          url: fileLink ? `https://www1.hkexnews.hk${fileLink}` : 'https://www.hkexnews.hk/',
          publishedAt: parseHkexDate(String(row.DATE_TIME || '')),
          position,
        });
      }
    } catch (error) {
      warnings.push(`HKEXnews failed for ${position.tickerBbg}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { items, fetched };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function collectPublicPortfolioNews(positions: PublicPortfolioPosition[]): Promise<PublicNewsResult> {
  const companyPositions = positions.filter(isCompanyLikePosition);
  const warnings: string[] = [];
  const collectors = await Promise.all([
    collectRssNews(companyPositions, warnings),
    collectGoogleNews(companyPositions, warnings),
    collectGdeltNews(companyPositions, warnings),
    collectSecNews(companyPositions, warnings),
    collectCninfoNews(companyPositions, warnings),
    collectHkexNews(companyPositions, warnings),
  ]);

  let fetched = 0;
  const byKey = new Map<string, FmpStockNewsItem>();
  for (const result of collectors) {
    fetched += result.fetched;
    for (const candidate of result.items) {
      const position = matchCandidate(candidate, companyPositions);
      if (!position || !isUsefulPublicCandidate(candidate)) continue;
      const item = toFmpNews(candidate, position);
      const key = [item.symbol, item.publishedAt, item.url || item.title].join('|').toLowerCase();
      if (!byKey.has(key)) byKey.set(key, item);
    }
  }

  return {
    items: Array.from(byKey.values()).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
    fetched,
    warnings,
  };
}
