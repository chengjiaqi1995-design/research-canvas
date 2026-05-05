import { fmpGet } from './fmpService';

type RawRow = Record<string, unknown>;

export interface FmpEarningsTableOptions {
  symbol: string;
  fiscalYear?: string | number;
  quarter?: string | number;
  date?: string;
}

export interface FmpEarningsTableResult {
  symbol: string;
  companyName?: string;
  fiscalYear?: string;
  period?: string;
  date?: string;
  unit: string;
  currency: string;
  markdown: string;
  marketReaction: {
    label: string;
    price?: number;
    previousClose?: number;
    changePercent?: number;
    timestamp?: string;
    note?: string;
  };
  sources: {
    incomeStatement: string;
    analystEstimates: string;
    quote: string;
    aftermarketTrade: string;
  };
}

const VALUE_METRICS = [
  { label: 'Revenue', key: 'revenue', consensusKey: 'revenueAvg' },
  { label: 'Gross profit', key: 'grossProfit' },
  { label: 'EBITDA', key: 'ebitda', consensusKey: 'ebitdaAvg' },
  { label: 'Operating income', key: 'operatingIncome', fallbackKey: 'ebit', consensusKey: 'ebitAvg' },
  { label: 'Net income', key: 'netIncome', consensusKey: 'netIncomeAvg' },
] as const;

const MARGIN_METRICS = [
  { label: 'Gross margin', numeratorKey: 'grossProfit' },
  { label: 'EBITDA margin', numeratorKey: 'ebitda', consensusNumeratorKey: 'ebitdaAvg' },
  { label: 'OPM', numeratorKey: 'operatingIncome', fallbackNumeratorKey: 'ebit', consensusNumeratorKey: 'ebitAvg' },
  { label: 'NPM', numeratorKey: 'netIncome', consensusNumeratorKey: 'netIncomeAvg' },
] as const;

function cleanSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

function cleanQuarter(value: string | number | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  const text = String(value).trim().toUpperCase();
  if (/^Q[1-4]$/.test(text)) return text;
  if (/^[1-4]$/.test(text)) return `Q${text}`;
  return text;
}

function fiscalYear(row: RawRow): string {
  return String(row.fiscalYear ?? row.calendarYear ?? '').trim();
}

function period(row: RawRow): string {
  return String(row.period ?? '').trim().toUpperCase();
}

function rowDate(row: RawRow): string {
  return String(row.date ?? '').slice(0, 10);
}

function asRows(raw: unknown): RawRow[] {
  if (Array.isArray(raw)) return raw as RawRow[];
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data as RawRow[];
  if (Array.isArray(obj.results)) return obj.results as RawRow[];
  return Object.keys(obj).length ? [obj] : [];
}

function asNumber(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function pickNumber(row: RawRow | undefined, keys: Array<string | undefined>): number | undefined {
  if (!row) return undefined;
  for (const key of keys) {
    if (!key) continue;
    const n = asNumber(row[key]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function sortDescByDate(rows: RawRow[]): RawRow[] {
  return [...rows].sort((a, b) => rowDate(b).localeCompare(rowDate(a)));
}

function findCurrentRow(rows: RawRow[], options: FmpEarningsTableOptions): RawRow | undefined {
  const targetYear = options.fiscalYear == null ? undefined : String(options.fiscalYear).trim();
  const targetQuarter = cleanQuarter(options.quarter);
  const targetDate = options.date ? String(options.date).slice(0, 10) : undefined;

  if (targetDate) {
    const byDate = rows.find((row) => rowDate(row) === targetDate);
    if (byDate) return byDate;
  }

  if (targetYear && targetQuarter) {
    const byPeriod = rows.find((row) => fiscalYear(row) === targetYear && period(row) === targetQuarter);
    if (byPeriod) return byPeriod;
  }

  if (targetYear) {
    const byYear = rows.find((row) => fiscalYear(row) === targetYear);
    if (byYear) return byYear;
  }

  return rows[0];
}

function findPriorYearRow(rows: RawRow[], current: RawRow): RawRow | undefined {
  const year = Number(fiscalYear(current));
  const currentPeriod = period(current);
  if (Number.isFinite(year) && currentPeriod) {
    const samePeriod = rows.find((row) => fiscalYear(row) === String(year - 1) && period(row) === currentPeriod);
    if (samePeriod) return samePeriod;
  }

  const currentTime = new Date(rowDate(current)).getTime();
  if (!Number.isFinite(currentTime)) return undefined;
  return rows
    .filter((row) => rowDate(row) < rowDate(current))
    .map((row) => ({ row, distance: Math.abs(new Date(rowDate(row)).getTime() - (currentTime - 365 * 24 * 60 * 60 * 1000)) }))
    .sort((a, b) => a.distance - b.distance)[0]?.row;
}

function findPriorQuarterRow(rows: RawRow[], current: RawRow): RawRow | undefined {
  return rows.find((row) => rowDate(row) < rowDate(current));
}

function findEstimateRow(rows: RawRow[], current: RawRow): RawRow | undefined {
  const currentDate = rowDate(current);
  const exact = rows.find((row) => rowDate(row) === currentDate);
  if (exact) return exact;

  const currentTime = new Date(currentDate).getTime();
  if (!Number.isFinite(currentTime)) return undefined;
  const maxDistance = 14 * 24 * 60 * 60 * 1000;
  return rows
    .map((row) => ({ row, distance: Math.abs(new Date(rowDate(row)).getTime() - currentTime) }))
    .filter((item) => Number.isFinite(item.distance) && item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.row;
}

function pctChange(current?: number, base?: number): number | undefined {
  if (current == null || base == null || base === 0) return undefined;
  return (current - base) / Math.abs(base);
}

function ratio(numerator?: number, denominator?: number): number | undefined {
  if (numerator == null || denominator == null || denominator === 0) return undefined;
  return numerator / denominator;
}

function moneyMn(value?: number): string {
  if (value == null) return '—';
  const scaled = value / 1_000_000;
  const abs = Math.abs(scaled);
  const digits = abs >= 100 ? 0 : 1;
  return scaled.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function percent(value?: number): string {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function marginPercent(value?: number): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function pptDiff(current?: number, base?: number): string {
  if (current == null || base == null) return '—';
  const value = (current - base) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}ppt`;
}

function markdownRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function buildValueRows(current: RawRow, priorYear?: RawRow, priorQuarter?: RawRow, estimate?: RawRow): string[] {
  return VALUE_METRICS.map((metric) => {
    const fallbackKey = 'fallbackKey' in metric ? metric.fallbackKey : undefined;
    const consensusKey = 'consensusKey' in metric ? metric.consensusKey : undefined;
    const currentValue = pickNumber(current, [metric.key, fallbackKey]);
    const priorYearValue = pickNumber(priorYear, [metric.key, fallbackKey]);
    const priorQuarterValue = pickNumber(priorQuarter, [metric.key, fallbackKey]);
    const consensusValue = pickNumber(estimate, [consensusKey]);

    return markdownRow([
      metric.label,
      moneyMn(currentValue),
      moneyMn(priorYearValue),
      percent(pctChange(currentValue, priorYearValue)),
      moneyMn(priorQuarterValue),
      percent(pctChange(currentValue, priorQuarterValue)),
      moneyMn(consensusValue),
      percent(pctChange(currentValue, consensusValue)),
    ]);
  });
}

function buildMarginRows(current: RawRow, priorYear?: RawRow, priorQuarter?: RawRow, estimate?: RawRow): string[] {
  const revenueCurrent = pickNumber(current, ['revenue']);
  const revenuePriorYear = pickNumber(priorYear, ['revenue']);
  const revenuePriorQuarter = pickNumber(priorQuarter, ['revenue']);
  const revenueConsensus = pickNumber(estimate, ['revenueAvg']);

  return MARGIN_METRICS.map((metric) => {
    const fallbackNumeratorKey = 'fallbackNumeratorKey' in metric ? metric.fallbackNumeratorKey : undefined;
    const consensusNumeratorKey = 'consensusNumeratorKey' in metric ? metric.consensusNumeratorKey : undefined;
    const currentMargin = ratio(pickNumber(current, [metric.numeratorKey, fallbackNumeratorKey]), revenueCurrent);
    const priorYearMargin = ratio(pickNumber(priorYear, [metric.numeratorKey, fallbackNumeratorKey]), revenuePriorYear);
    const priorQuarterMargin = ratio(pickNumber(priorQuarter, [metric.numeratorKey, fallbackNumeratorKey]), revenuePriorQuarter);
    const consensusMargin = ratio(pickNumber(estimate, [consensusNumeratorKey]), revenueConsensus);

    return markdownRow([
      metric.label,
      marginPercent(currentMargin),
      marginPercent(priorYearMargin),
      pptDiff(currentMargin, priorYearMargin),
      marginPercent(priorQuarterMargin),
      pptDiff(currentMargin, priorQuarterMargin),
      marginPercent(consensusMargin),
      pptDiff(currentMargin, consensusMargin),
    ]);
  });
}

function timestampToIso(value: unknown): string | undefined {
  const n = asNumber(value);
  if (n == null) return undefined;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildMarketReaction(quote?: RawRow, aftermarketTrade?: RawRow) {
  const previousClose = pickNumber(quote, ['previousClose']);
  const aftermarketPrice = pickNumber(aftermarketTrade, ['price']);
  const latestPrice = pickNumber(quote, ['price']);
  const hasAftermarket = aftermarketPrice != null;
  const price = hasAftermarket ? aftermarketPrice : latestPrice;
  const timestamp = timestampToIso(hasAftermarket ? aftermarketTrade?.timestamp : quote?.timestamp);
  const changePercent = price != null && previousClose != null
    ? pctChange(price, previousClose)
    : pickNumber(quote, ['changePercentage']) != null
      ? pickNumber(quote, ['changePercentage'])! / 100
      : undefined;

  return {
    label: hasAftermarket ? '盘前/盘后报价' : '最新报价',
    price,
    previousClose,
    changePercent,
    timestamp,
    note: hasAftermarket ? undefined : 'FMP未披露盘前/盘后，仅显示最新报价',
  };
}

function formatMarketReaction(reaction: ReturnType<typeof buildMarketReaction>): string {
  const priceText = reaction.price == null ? '$—' : `$${reaction.price.toFixed(2)}`;
  const changeText = percent(reaction.changePercent);
  const timeText = reaction.timestamp || '—';
  const suffix = reaction.note ? `；${reaction.note}` : '';
  return `股价反应（FMP）：${reaction.label} ${priceText}（vs prior close ${changeText}），时间：${timeText}${suffix}。`;
}

export async function buildFmpEarningsTable(options: FmpEarningsTableOptions): Promise<FmpEarningsTableResult> {
  const symbol = cleanSymbol(options.symbol);
  if (!symbol) {
    const err = new Error('symbol is required');
    (err as any).status = 400;
    throw err;
  }

  const [incomeRaw, estimatesRaw, quoteRaw, aftermarketRaw] = await Promise.all([
    fmpGet<unknown>('/income-statement', { symbol, period: 'quarter', limit: 24 }, 30 * 60 * 1000),
    fmpGet<unknown>('/analyst-estimates', { symbol, period: 'quarter', limit: 80 }, 30 * 60 * 1000),
    fmpGet<unknown>('/quote', { symbol }, 60 * 1000),
    fmpGet<unknown>('/aftermarket-trade', { symbol }, 60 * 1000).catch(() => []),
  ]);

  const incomeRows = sortDescByDate(asRows(incomeRaw));
  const estimateRows = sortDescByDate(asRows(estimatesRaw));
  const current = findCurrentRow(incomeRows, options);
  if (!current) {
    const err = new Error(`No quarterly income statement found for ${symbol}`);
    (err as any).status = 404;
    throw err;
  }

  const priorYear = findPriorYearRow(incomeRows, current);
  const priorQuarter = findPriorQuarterRow(incomeRows, current);
  const estimate = findEstimateRow(estimateRows, current);
  const quote = asRows(quoteRaw)[0];
  const aftermarketTrade = asRows(aftermarketRaw)[0];
  const reaction = buildMarketReaction(quote, aftermarketTrade);

  const currency = String(current.reportedCurrency || 'USD').trim() || 'USD';
  const unit = `${currency} mn`;
  const companyName = String(quote?.name || '').trim() || undefined;

  const lines = [
    `单位：${unit}${currency !== 'USD' ? `（公司报告币种为 ${currency}）` : ''}`,
    '',
    '| 指标 | 当前季度 | 去年同期 | YoY | 上季度 | QoQ | consensus | vs consensus |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...buildValueRows(current, priorYear, priorQuarter, estimate),
    '',
    '| Margin 指标 | 当前季度 | 去年同期 | YoY | 上季度 | QoQ | consensus | vs consensus |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...buildMarginRows(current, priorYear, priorQuarter, estimate),
    '',
    formatMarketReaction(reaction),
  ];

  return {
    symbol,
    companyName,
    fiscalYear: fiscalYear(current) || undefined,
    period: period(current) || undefined,
    date: rowDate(current) || undefined,
    unit,
    currency,
    markdown: lines.join('\n'),
    marketReaction: reaction,
    sources: {
      incomeStatement: '/income-statement?period=quarter',
      analystEstimates: '/analyst-estimates?period=quarter',
      quote: '/quote',
      aftermarketTrade: '/aftermarket-trade',
    },
  };
}
