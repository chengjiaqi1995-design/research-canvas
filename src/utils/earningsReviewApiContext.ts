import { getFmpEarningsTable } from '../aiprocess/api/portfolio';
import type { AISkill } from '../types/index';

type SkillLike = Partial<Pick<AISkill, 'name' | 'description' | 'content'>>;

interface EarningsApiContextOptions {
  skill?: SkillLike;
  prompt?: string;
  context?: string;
}

const COMMON_TICKER_WORDS = new Set([
  'API', 'FMP', 'MCP', 'USD', 'HKD', 'CNY', 'JPY', 'EUR', 'GBP', 'FY', 'Q',
  'YOY', 'QOQ', 'EBIT', 'EBITDA', 'EPS', 'OPM', 'NPM', 'IR', 'PDF', 'HTML',
  'US', 'HK', 'CN', 'JP', 'UK', 'EU', 'CEO', 'CFO', 'COO', 'GAAP', 'NON',
  'ADJ', 'ADJUSTED', 'ANNUAL', 'CALL', 'COMMENTARY', 'CONFERENCE', 'DATA',
  'EARNINGS', 'FINANCIAL', 'GUIDANCE', 'MANAGEMENT', 'OPERATOR', 'PRESENTATION',
  'QUARTER', 'QUESTIONS', 'REMARKS', 'REPORT', 'RESULTS', 'SOURCE', 'TRANSCRIPT',
  'WEBCAST',
]);

function isEarningsReviewSkill(skill?: SkillLike): boolean {
  if (!skill) return false;
  const haystack = [skill.name, skill.description, skill.content].filter(Boolean).join('\n').toLowerCase();
  return (
    haystack.includes('earnings-review') ||
    haystack.includes('/api/portfolio/fmp/earnings-table') ||
    (haystack.includes('业绩点评') && haystack.includes('fmp')) ||
    (haystack.includes('earnings') && haystack.includes('fixed') && haystack.includes('table'))
  );
}

function cleanTicker(value?: string): string | undefined {
  const text = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^[\s.$([{]+/, '')
    .replace(/[\s\])},.。;；:：]+$/, '');
  if (!text || COMMON_TICKER_WORDS.has(text)) return undefined;
  if (/^\d{1,6}\.(HK|T|SS|SZ|NS|BO|L|PA|DE|TO|AX)$/.test(text)) return text;
  if (/^[A-Z][A-Z0-9.-]{0,11}$/.test(text)) return text;
  return undefined;
}

function extractSymbol(text: string, allowLooseFallback = false): string | undefined {
  const patterns = [
    /(?:symbol|ticker|代码|股票代码)\s*[:=：]\s*([A-Za-z0-9.-]{1,16})/i,
    /[（(]\s*([A-Za-z][A-Za-z0-9.-]{0,11})\s*[）)]/,
    /(?:点评|分析|业绩|财报|季报|年报|transcript|earnings|review|call)\s+([A-Za-z][A-Za-z0-9.-]{1,11})\b/i,
    /\b([A-Za-z][A-Za-z0-9.-]{1,11})\s+(?:FY\s*)?(?:20\d{2}|\d{2})\s*Q\s*[1-4]\b/i,
    /\b([A-Za-z][A-Za-z0-9.-]{1,11})\s+[1-4]\s*Q\s*(?:20\d{2}|\d{2})\b/i,
    /\$([A-Za-z][A-Za-z0-9.-]{0,11})\b/,
    /\b(?:NASDAQ|NYSE|AMEX|HKEX|TSE|LSE)\s*[:：]\s*([A-Za-z0-9.-]{1,16})\b/i,
    /\[([A-Za-z0-9.-]{1,16})\s+(?:US|UN|UQ|UP|HK|JP|CH|CN|LN|GR|FP|IN|SS|SZ)\]/i,
    /\b([A-Za-z0-9.-]{1,16})\s+(?:US|UN|UQ|UP|HK|JP|CH|CN|LN|GR|FP|IN|SS|SZ)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const ticker = cleanTicker(match?.[1]);
    if (ticker) return ticker;
  }

  if (!allowLooseFallback) return undefined;

  const candidates = text.match(/\b[A-Z][A-Z0-9.-]{1,11}\b/g) || [];
  for (const candidate of candidates) {
    const ticker = cleanTicker(candidate);
    if (ticker) return ticker;
  }
  return undefined;
}

function normalizeTwoDigitYear(value: number): number {
  if (value >= 100) return value;
  return value >= 70 ? 1900 + value : 2000 + value;
}

function extractPeriod(text: string): { year?: number; quarter?: number } {
  const compact = text.replace(/\s+/g, ' ');

  let match = compact.match(/\bFY\s*(20\d{2}|\d{2})\s*Q\s*([1-4])\b/i)
    || compact.match(/\b(20\d{2})\s*[/-]?\s*Q\s*([1-4])\b/i)
    || compact.match(/\bQ\s*([1-4])\s*(20\d{2}|\d{2})\b/i);
  if (match) {
    if (/^Q/i.test(match[0])) {
      return { quarter: Number(match[1]), year: normalizeTwoDigitYear(Number(match[2])) };
    }
    return { year: normalizeTwoDigitYear(Number(match[1])), quarter: Number(match[2]) };
  }

  match = compact.match(/\b([1-4])Q\s*(20\d{2}|\d{2})\b/i);
  if (match) return { quarter: Number(match[1]), year: normalizeTwoDigitYear(Number(match[2])) };

  match = compact.match(/\bFY\s*(20\d{2}|\d{2})\b/i);
  if (match) return { year: normalizeTwoDigitYear(Number(match[1])) };

  return {};
}

export async function buildEarningsReviewApiPromptContext({
  skill,
  prompt = '',
  context = '',
}: EarningsApiContextOptions): Promise<string | null> {
  if (!isEarningsReviewSkill(skill)) return null;

  const searchText = [prompt, context].filter(Boolean).join('\n\n');
  const symbol = extractSymbol(prompt, true) || extractSymbol(context);
  if (!symbol) return null;

  const { year, quarter } = extractPeriod(searchText);

  try {
    const response = await getFmpEarningsTable({
      symbol,
      year,
      quarter,
    });
    const table = response.data?.data;
    if (!table?.markdown) return null;

    const periodLabel = [table.fiscalYear ? `FY${table.fiscalYear}` : '', table.period || '']
      .filter(Boolean)
      .join(' ');

    return [
      '## 已调用 Research Canvas FMP API 获取固定表格',
      `Ticker: ${table.symbol}${table.companyName ? ` (${table.companyName})` : ''}`,
      periodLabel ? `Period: ${periodLabel}` : '',
      table.date ? `Fiscal date: ${table.date}` : '',
      '',
      '以下 Markdown 必须原样放在最终输出最开头，不要包裹代码块，不要二次手算表格数字：',
      '',
      table.markdown,
    ].filter(Boolean).join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      '## Research Canvas FMP API 调用状态',
      `已识别 ticker: ${symbol}${year ? `, year: ${year}` : ''}${quarter ? `, quarter: ${quarter}` : ''}`,
      `FMP earnings-table API 调用失败：${message}`,
      '最终答案不要原样输出本段错误日志；请按 earnings-review skill 的 fallback 规则使用 FMP MCP、FMP 原始 API 或公开资料补表，并标注待确认字段。',
    ].join('\n');
  }
}
