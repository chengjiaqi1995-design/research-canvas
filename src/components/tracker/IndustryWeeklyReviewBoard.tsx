import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Equal,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { aiApi, feedApi, trackerApi } from '../../db/apiClient.ts';
import type { FeedItem } from '../../db/apiClient.ts';
import type {
  IndustryReviewPeriodType,
  IndustryWeeklyRating,
  IndustryWeeklyReview,
} from '../../types/index.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';
import { IconButton, PrimaryButton, SegmentedToggle } from '../ui/index.ts';

export interface CompanyReviewTarget {
  name: string;
  workspaceId?: string;
}

export interface IndustryReviewTarget {
  name: string;
  workspaceId?: string;
  companies?: CompanyReviewTarget[];
}

interface GeneratedReview {
  industryName: string;
  rating?: string;
  summary?: string;
  demand?: string;
  supplyDemandSignals?: string[] | string;
  watchPoints?: string[] | string;
}

interface GeneratedPayload {
  reviews?: GeneratedReview[];
  industries?: GeneratedReview[];
}

interface PeriodColumn {
  type: IndustryReviewPeriodType;
  key: string;
  start: string;
  end: string;
  label: string;
  subLabel: string;
}

interface IndustryGroup {
  target: IndustryReviewTarget;
  companies: CompanyReviewTarget[];
}

type ReviewField = 'summary' | 'demand' | 'other' | 'company';

const DEFAULT_WEEK_COLUMNS = 12;
const DEFAULT_MONTH_COLUMNS = 6;
const MAX_FALLBACK_FEEDS = 80;
const BOARD_REFRESH_INTERVAL_MS = 90_000;
const FEED_UPDATE_POLL_INTERVAL_MS = 90_000;

const INDUSTRY_SECTION_ROWS: Array<{ field: ReviewField; label: string }> = [
  { field: 'summary', label: '观点' },
  { field: 'demand', label: '需求/价格' },
  { field: 'other', label: '其他' },
];

const RATING_OPTIONS: Array<{ value: IndustryWeeklyRating; icon: typeof Plus; label: string; className: string }> = [
  { value: '+', icon: Plus, label: '正向', className: 'border-emerald-600 bg-emerald-600 text-white' },
  { value: '=', icon: Equal, label: '中性', className: 'border-slate-900 bg-slate-900 text-white' },
  { value: '-', icon: Minus, label: '负向', className: 'border-red-600 bg-red-600 text-white' },
];

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function addDays(value: string, days: number) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatWeekLabel(weekStart: string) {
  return weekStart.slice(5).replace('-', '/');
}

function formatMonthLabel(monthKey: string) {
  return monthKey.replace('-', '/');
}

function monthKeyFromDate(dateValue: string) {
  return dateValue.slice(0, 7);
}

function addMonths(monthKey: string, delta: number) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function startOfMonth(monthKey: string) {
  return `${monthKey}-01`;
}

function endOfMonth(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return toDateInputValue(new Date(year, month, 0));
}

function buildWeekColumns(anchorWeekStart: string, count: number): PeriodColumn[] {
  return Array.from({ length: count }, (_, index) => {
    const weekStart = addDays(anchorWeekStart, (index - count + 1) * 7);
    const weekEnd = addDays(weekStart, 6);
    return {
      type: 'week',
      key: weekStart,
      start: weekStart,
      end: weekEnd,
      label: formatWeekLabel(weekStart),
      subLabel: weekEnd.slice(5).replace('-', '/'),
    };
  });
}

function buildMonthColumns(anchorMonth: string, count: number): PeriodColumn[] {
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(anchorMonth, index - count + 1);
    return {
      type: 'month',
      key: month,
      start: startOfMonth(month),
      end: endOfMonth(month),
      label: formatMonthLabel(month),
      subLabel: '月',
    };
  });
}

function buildWeeksCoveringMonths(months: PeriodColumn[]): PeriodColumn[] {
  if (months.length === 0) return [];
  const firstWeekStart = toDateInputValue(startOfWeek(parseLocalDate(months[0].start)));
  const lastDay = months[months.length - 1].end;
  const weeks: PeriodColumn[] = [];
  for (let current = firstWeekStart; current <= lastDay; current = addDays(current, 7)) {
    const weekEnd = addDays(current, 6);
    weeks.push({
      type: 'week',
      key: current,
      start: current,
      end: weekEnd,
      label: formatWeekLabel(current),
      subLabel: weekEnd.slice(5).replace('-', '/'),
    });
  }
  return weeks;
}

function weekOverlapsMonth(week: PeriodColumn, month: PeriodColumn) {
  return week.start <= month.end && week.end >= month.start;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/\r?\n|[；;]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeRating(value: unknown): IndustryWeeklyRating {
  return value === '+' || value === '-' || value === '=' ? value : '=';
}

function cleanDemandText(value: string) {
  return value.replace(/^\s*(?:[+\-=]|正向|负向|中性|好|差|正常)\s*[：:、,\-]?\s*/u, '');
}

function demandToneClass(value: string) {
  const text = cleanDemandText(value).toLowerCase();
  if (!text.trim()) return 'bg-white';

  const negativePatterns = [
    /不好|不佳|较差|偏弱|疲弱|走弱|下滑|下降|放缓|承压|压力|减少|萎缩|低迷|恶化|不足|不及|无明显改善|没有改善|未改善/,
    /\b(weak|soft|negative|decline|declining|slowing|pressure|poor|bad)\b/i,
  ];
  if (negativePatterns.some((pattern) => pattern.test(text))) {
    return 'border-red-200 bg-red-50/70 text-red-800 focus:border-red-300 focus:bg-red-50';
  }

  const positivePatterns = [
    /好|较好|偏好|强|强劲|改善|增长|增加|回暖|旺盛|提升|超预期|上行|订单好|需求高/,
    /\b(strong|positive|improving|improved|growth|growing|upside|robust)\b/i,
  ];
  if (positivePatterns.some((pattern) => pattern.test(text))) {
    return 'border-emerald-200 bg-emerald-50/70 text-emerald-800 focus:border-emerald-300 focus:bg-emerald-50';
  }

  return 'bg-white';
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[\s\-_/|｜:：()[\]（）]+/g, '');
}

function getReviewPeriodType(review: Partial<IndustryWeeklyReview>): IndustryReviewPeriodType {
  return review.periodType === 'month' ? 'month' : 'week';
}

function getReviewPeriodKey(review: Partial<IndustryWeeklyReview>) {
  const periodType = getReviewPeriodType(review);
  if (review.periodKey) return periodType === 'month' ? review.periodKey.slice(0, 7) : review.periodKey.slice(0, 10);
  if (periodType === 'month') return monthKeyFromDate(String(review.weekStart || ''));
  return String(review.weekStart || '').slice(0, 10);
}

function reviewKeyFromParts(periodType: IndustryReviewPeriodType, periodKey: string, industryName: string, companyName = '') {
  return `${periodType}::${periodKey}::${normalizeName(industryName)}::${normalizeName(companyName)}`;
}

function reviewKey(review: Partial<IndustryWeeklyReview>) {
  return reviewKeyFromParts(
    getReviewPeriodType(review),
    getReviewPeriodKey(review),
    String(review.industryName || ''),
    String(review.companyName || ''),
  );
}

function hasReviewContent(review: IndustryWeeklyReview) {
  return Boolean(
    review.summary.trim() ||
      review.demand.trim() ||
      review.supplyDemandSignals.length ||
      review.watchPoints.length ||
      (review.userNotes || '').trim() ||
      review.rating !== '=',
  );
}

function dedupeReviews(reviews: IndustryWeeklyReview[]) {
  const byKey = new Map<string, IndustryWeeklyReview>();
  for (const review of reviews) byKey.set(reviewKey(review), review);
  return Array.from(byKey.values());
}

function joinDistinct(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    for (const item of String(value || '').split(/\r?\n|[；;]/)) {
      const text = item.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
    }
  }
  return result.join('\n');
}

function otherTextParts(review: IndustryWeeklyReview) {
  return [
    review.userNotes || '',
    ...(review.supplyDemandSignals || []),
    ...(review.watchPoints || []),
  ].filter(Boolean);
}

function makeDraftReview(
  target: IndustryReviewTarget,
  period: PeriodColumn,
  company?: CompanyReviewTarget,
): IndustryWeeklyReview {
  const companyName = company?.name || '';
  const normalizedCompany = normalizeName(companyName) || 'industry';
  return {
    id: `draft-${period.type}-${period.key}-${normalizeName(target.name) || target.name}-${normalizedCompany}`,
    industryName: target.name,
    workspaceId: company?.workspaceId || target.workspaceId,
    periodType: period.type,
    periodKey: period.key,
    scopeType: companyName ? 'company' : 'industry',
    companyName,
    weekStart: period.start,
    weekEnd: period.end,
    rating: '=',
    summary: '',
    demand: '',
    supplyDemandSignals: [],
    watchPoints: [],
    userNotes: '',
    sourceFeedIds: [],
    sourceTitles: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function mergedMonthReview(
  target: IndustryReviewTarget,
  month: PeriodColumn,
  company: CompanyReviewTarget | undefined,
  weekColumns: PeriodColumn[],
  lookup: Map<string, IndustryWeeklyReview>,
) {
  const draft = makeDraftReview(target, month, company);
  const weeklyReviews = weekColumns
    .filter((week) => weekOverlapsMonth(week, month))
    .map((week) => lookup.get(reviewKeyFromParts('week', week.key, target.name, company?.name || '')))
    .filter((review): review is IndustryWeeklyReview => Boolean(review && hasReviewContent(review)));

  if (weeklyReviews.length === 0) return draft;

  const latestDirectional = weeklyReviews
    .slice()
    .reverse()
    .find((review) => review.rating !== '=');

  return {
    ...draft,
    rating: latestDirectional?.rating || weeklyReviews[weeklyReviews.length - 1].rating || '=',
    summary: joinDistinct(weeklyReviews.map((review) => review.summary)),
    demand: joinDistinct(weeklyReviews.map((review) => cleanDemandText(review.demand))),
    supplyDemandSignals: Array.from(new Set(weeklyReviews.flatMap((review) => review.supplyDemandSignals || []))),
    watchPoints: Array.from(new Set(weeklyReviews.flatMap((review) => review.watchPoints || []))),
    userNotes: joinDistinct(weeklyReviews.flatMap(otherTextParts)),
    sourceFeedIds: Array.from(new Set(weeklyReviews.flatMap((review) => review.sourceFeedIds || []))),
    sourceTitles: Array.from(new Set(weeklyReviews.flatMap((review) => review.sourceTitles || []))),
  };
}

function stripMarkup(input: string) {
  return String(input || '')
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

function truncateText(input: string, maxLength: number) {
  const text = stripMarkup(input);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function feedTimestamp(item: FeedItem) {
  const raw = item.publishedAt || item.createdAt || item.pushedAt;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function feedUpdateTimestamp(item: FeedItem) {
  const raw = item.updatedAt || item.pushedAt || item.createdAt || item.publishedAt;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatShortTime(value: number | null) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isSummaryReportFeed(item: FeedItem) {
  const haystack = [
    item.type,
    item.category,
    item.title,
    item.source,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return haystack.includes('weekly') || haystack.includes('周报') || haystack.includes('总结报告') || item.type === 'weekly';
}

function selectFeedsForWeek(items: FeedItem[], weekStart: string, weekEnd: string) {
  const start = parseLocalDate(weekStart).getTime();
  const end = parseLocalDate(addDays(weekEnd, 1)).getTime();
  const inRange = items.filter((item) => {
    const time = feedTimestamp(item);
    return time >= start && time < end;
  });

  const source = inRange.length > 0 ? inRange : items.slice(0, MAX_FALLBACK_FEEDS);
  const summaryReports = source.filter(isSummaryReportFeed);
  const evidenceSource = summaryReports.length > 0 ? summaryReports : source;
  return evidenceSource
    .slice()
    .sort((a, b) => {
      const aWeekly = a.type === 'weekly' ? 1 : 0;
      const bWeekly = b.type === 'weekly' ? 1 : 0;
      if (aWeekly !== bWeekly) return bWeekly - aWeekly;
      return feedTimestamp(b) - feedTimestamp(a);
    })
    .slice(0, 80);
}

function buildFeedDigest(feeds: FeedItem[]) {
  return feeds.map((item, index) => ({
    ref: `F${index + 1}`,
    id: item.id,
    type: item.type,
    category: item.category,
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
    content: truncateText(item.content, isSummaryReportFeed(item) ? 6000 : 420),
  }));
}

function extractJsonObject(text: string): GeneratedPayload {
  const cleaned = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('AI 返回不是合法 JSON');
  }
}

function buildGenerationPrompt(targets: IndustryReviewTarget[], feeds: FeedItem[], weekStart: string, weekEnd: string) {
  return `请基于信息流内容，为下列 Canvas 行业生成本周行业周评。

周度区间：${weekStart} 至 ${weekEnd}

行业列表：
${targets.map((target, index) => `${index + 1}. ${target.name}`).join('\n')}

信息流摘录：
${JSON.stringify(buildFeedDigest(feeds), null, 2)}

输出要求：
- 只输出 JSON，不要 markdown。
- 只输出被信息流直接提到、且有明确证据的行业；没有被提到的行业不要写入 JSON，不要生成“本周没有提到”的占位内容。
- summary 是一到两句话的本周评价。
- demand 写需求、价格和订单变化。
- supplyDemandSignals 写 1-3 条其他供需信号，优先写库存/产能/供给限制/交付/政策传导。
- watchPoints 写 1-3 条未来需要注意的提示，必须把事件/关注发生月份写在开头，格式为 "YYYY-MM：提示" 或 "M月：提示"；不要使用周报创建日期作为提示时间。
- rating 只能是 "+"、"-" 或 "="：+ 表示基本面或需求边际改善，- 表示恶化或风险上升，= 表示中性/证据不足/变化不大。
- 如果证据只是间接相关，除非周报明确给出强方向，否则 rating 用 "="。

JSON schema:
{
  "reviews": [
    {
      "industryName": "必须与行业列表一致",
      "summary": "一到两句话",
      "demand": "需求、价格和订单变化",
      "supplyDemandSignals": ["其他信号1"],
      "watchPoints": ["2026-05：提示1"],
      "rating": "="
    }
  ]
}`;
}

function findGeneratedForIndustry(industryName: string, generated: GeneratedReview[]) {
  const normalized = normalizeName(industryName);
  return (
    generated.find((item) => normalizeName(item.industryName || '') === normalized) ||
    generated.find((item) => {
      const other = normalizeName(item.industryName || '');
      return Boolean(other && (other.includes(normalized) || normalized.includes(other)));
    })
  );
}

function reviewFieldValue(review: IndustryWeeklyReview, field: ReviewField) {
  if (field === 'demand') return cleanDemandText(review.demand);
  if (field === 'other') return review.userNotes || '';
  return review.summary;
}

function reviewFieldPlaceholder(review: IndustryWeeklyReview, field: ReviewField) {
  if (field === 'other') {
    const fallback = joinDistinct([...(review.supplyDemandSignals || []), ...(review.watchPoints || [])]);
    return fallback || '+';
  }
  return '+';
}

function reviewFieldPatch(field: ReviewField, value: string): Partial<IndustryWeeklyReview> {
  if (field === 'demand') return { demand: value };
  if (field === 'other') return { userNotes: value };
  return { summary: value };
}

function ReviewCell({
  review,
  field,
  onChange,
  onOpen,
}: {
  review: IndustryWeeklyReview;
  field: ReviewField;
  onChange: (review: IndustryWeeklyReview, patch: Partial<IndustryWeeklyReview>) => void;
  onOpen: (review: IndustryWeeklyReview) => void;
}) {
  const value = reviewFieldValue(review, field);
  const isViewField = field === 'summary';
  const tone = field === 'demand' ? demandToneClass(review.demand) : 'bg-white';

  return (
    <td className="w-52 min-w-52 border-r border-slate-100 bg-white p-1 align-top last:border-r-0">
      <div className="group/cell relative min-h-14">
        {isViewField && (
          <div className="mb-1 flex items-center gap-0.5 pr-5">
            {RATING_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = review.rating === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  onClick={() => onChange(review, { rating: option.value })}
                  className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                    active
                      ? option.className
                      : 'border-slate-300 bg-white text-slate-500 hover:border-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon size={9} strokeWidth={3} />
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => onOpen(review)}
          className="absolute right-0 top-0 rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-blue-50 hover:text-blue-600 group-hover/cell:opacity-100"
          title="编辑详情"
        >
          <Pencil size={11} />
        </button>
        <textarea
          value={value}
          onChange={(event) => onChange(review, reviewFieldPatch(field, event.target.value))}
          className={`h-12 w-full resize-none rounded border border-transparent px-2 py-1 text-[11px] leading-4 text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-blue-200 focus:bg-white focus:ring-1 focus:ring-blue-100 ${
            field === 'demand' ? tone : 'bg-white'
          }`}
          placeholder={reviewFieldPlaceholder(review, field)}
        />
      </div>
    </td>
  );
}

export const IndustryWeeklyReviewBoard = memo(function IndustryWeeklyReviewBoard({
  industries,
}: {
  industries: IndustryReviewTarget[];
}) {
  const [viewMode, setViewMode] = useState<IndustryReviewPeriodType>('week');
  const [anchorWeekStart, setAnchorWeekStart] = useState(() => toDateInputValue(startOfWeek(new Date())));
  const [anchorMonth, setAnchorMonth] = useState(() => monthKeyFromDate(toDateInputValue(new Date())));
  const [weekCount, setWeekCount] = useState(DEFAULT_WEEK_COLUMNS);
  const [monthCount, setMonthCount] = useState(DEFAULT_MONTH_COLUMNS);
  const [showOnlyWithContent, setShowOnlyWithContent] = useState(true);
  const [reviews, setReviews] = useState<IndustryWeeklyReview[]>([]);
  const [editingReviewKey, setEditingReviewKey] = useState<string | null>(null);
  const [collapsedIndustries, setCollapsedIndustries] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [isDirectPreparing, setIsDirectPreparing] = useState(false);
  const [newFeedCount, setNewFeedCount] = useState(0);
  const [latestFeedTitle, setLatestFeedTitle] = useState('');
  const [lastFeedCheckAt, setLastFeedCheckAt] = useState<number | null>(null);
  const feedBaselineRef = useRef<number | null>(null);
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const weekColumns = useMemo(() => buildWeekColumns(anchorWeekStart, weekCount), [anchorWeekStart, weekCount]);
  const monthColumns = useMemo(() => buildMonthColumns(anchorMonth, monthCount), [anchorMonth, monthCount]);
  const periodColumns = viewMode === 'week' ? weekColumns : monthColumns;
  const monthMergeWeekColumns = useMemo(() => buildWeeksCoveringMonths(monthColumns), [monthColumns]);
  const weekQueryColumns = viewMode === 'week' ? weekColumns : monthMergeWeekColumns;
  const currentWeek = weekColumns[weekColumns.length - 1];

  const reviewLookup = useMemo(() => {
    return new Map(reviews.map((review) => [reviewKey(review), review]));
  }, [reviews]);

  const getCellReview = useCallback((
    target: IndustryReviewTarget,
    period: PeriodColumn,
    company?: CompanyReviewTarget,
  ) => {
    const saved = reviewLookup.get(reviewKeyFromParts(period.type, period.key, target.name, company?.name || ''));
    if (saved) return saved;
    if (period.type === 'month') {
      return mergedMonthReview(target, period, company, monthMergeWeekColumns, reviewLookup);
    }
    return makeDraftReview(target, period, company);
  }, [monthMergeWeekColumns, reviewLookup]);

  const industryGroups = useMemo<IndustryGroup[]>(() => {
    const industryOrder = new Map(industries.map((industry, index) => [normalizeName(industry.name), index]));
    const byName = new Map<string, IndustryGroup>();
    const ensureGroup = (name: string, workspaceId?: string) => {
      const key = normalizeName(name);
      if (!byName.has(key)) {
        byName.set(key, { target: { name, workspaceId, companies: [] }, companies: [] });
      }
      return byName.get(key)!;
    };

    for (const industry of industries) {
      const group = ensureGroup(industry.name, industry.workspaceId);
      group.target = industry;
      const companies = new Map<string, CompanyReviewTarget>();
      for (const company of industry.companies || []) companies.set(normalizeName(company.name), company);
      group.companies = Array.from(companies.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }

    for (const review of reviews) {
      const group = ensureGroup(review.industryName, review.workspaceId);
      if (review.companyName) {
        const existing = group.companies.find((company) => normalizeName(company.name) === normalizeName(review.companyName || ''));
        if (!existing) group.companies.push({ name: review.companyName, workspaceId: review.workspaceId });
      }
    }

    const groups = Array.from(byName.values())
      .map((group) => ({
        ...group,
        companies: group.companies.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
      }))
      .sort((a, b) => {
        const aOrder = industryOrder.get(normalizeName(a.target.name)) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = industryOrder.get(normalizeName(b.target.name)) ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.target.name.localeCompare(b.target.name, 'zh-Hans-CN');
      });

    if (!showOnlyWithContent) return groups;

    return groups.filter((group) => {
      const hasIndustryContent = periodColumns.some((period) => hasReviewContent(getCellReview(group.target, period)));
      if (hasIndustryContent) return true;
      return group.companies.some((company) =>
        periodColumns.some((period) => hasReviewContent(getCellReview(group.target, period, company))),
      );
    });
  }, [getCellReview, industries, periodColumns, reviews, showOnlyWithContent]);

  const editingReview = useMemo(
    () => reviews.find((review) => reviewKey(review) === editingReviewKey) || null,
    [editingReviewKey, reviews],
  );

  const loadReviews = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setIsLoading(true);
      setErrorText('');
    }

    try {
      const [weeklyResults, monthlyResults] = await Promise.all([
        Promise.all(weekQueryColumns.map((week) => trackerApi.getWeeklyReviews({ periodType: 'week', weekStart: week.key }))),
        viewMode === 'month'
          ? Promise.all(monthColumns.map((month) => trackerApi.getWeeklyReviews({ periodType: 'month', periodKey: month.key })))
          : Promise.resolve([] as IndustryWeeklyReview[][]),
      ]);
      if (silent && dirtyRef.current) return;
      setReviews(dedupeReviews([...weeklyResults.flat(), ...monthlyResults.flat()]));
      setDirty(false);
    } catch (error: any) {
      if (!silent) setErrorText(error?.message || '周评加载失败');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [monthColumns, viewMode, weekQueryColumns]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const checkFeedUpdates = useCallback(async (options?: { reset?: boolean }) => {
    try {
      const result = await feedApi.list({ page: 1, pageSize: 50, sortBy: 'updatedAt' });
      const items = result.data || [];
      const latestTime = Math.max(0, ...items.map(feedUpdateTimestamp));
      const shouldReset = options?.reset || feedBaselineRef.current === null;

      if (shouldReset) {
        feedBaselineRef.current = latestTime;
        setNewFeedCount(0);
        setLatestFeedTitle('');
        setLastFeedCheckAt(Date.now());
        return;
      }

      const baseline = feedBaselineRef.current || 0;
      const newItems = items.filter((item) => feedUpdateTimestamp(item) > baseline);
      setNewFeedCount(newItems.length);
      setLatestFeedTitle(newItems[0]?.title || '');
      setLastFeedCheckAt(Date.now());
    } catch (error) {
      console.error('Failed to poll feed updates for industry board', error);
    }
  }, []);

  const acknowledgeFeedUpdates = useCallback(async () => {
    await Promise.all([
      checkFeedUpdates({ reset: true }),
      dirty ? Promise.resolve() : loadReviews({ silent: true }),
    ]);
    setStatusText('已同步最新推送状态');
  }, [checkFeedUpdates, dirty, loadReviews]);

  useEffect(() => {
    void checkFeedUpdates({ reset: true });
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void checkFeedUpdates();
    }, FEED_UPDATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkFeedUpdates]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (dirty || isSaving || isGenerating || isDirectPreparing || isLoading) return;
      void loadReviews({ silent: true });
    }, BOARD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [dirty, isDirectPreparing, isGenerating, isLoading, isSaving, loadReviews]);

  const updateReview = useCallback((review: IndustryWeeklyReview, patch: Partial<IndustryWeeklyReview>) => {
    const key = reviewKey(review);
    setReviews((current) => {
      let matched = false;
      const next = current.map((item) => {
        if (reviewKey(item) !== key) return item;
        matched = true;
        return { ...item, ...patch, updatedAt: Date.now() };
      });
      if (matched) return next;
      return [...next, { ...review, ...patch, updatedAt: Date.now() }];
    });
    setDirty(true);
  }, []);

  const openReviewEditor = useCallback((review: IndustryWeeklyReview) => {
    const key = reviewKey(review);
    setReviews((current) => current.some((item) => reviewKey(item) === key) ? current : [...current, review]);
    setEditingReviewKey(key);
  }, []);

  const collectVisibleReviews = useCallback(() => {
    const visible: IndustryWeeklyReview[] = [];
    for (const group of industryGroups) {
      for (const period of periodColumns) {
        visible.push(getCellReview(group.target, period));
        for (const company of group.companies) {
          visible.push(getCellReview(group.target, period, company));
        }
      }
    }
    return dedupeReviews([...reviews, ...visible]);
  }, [getCellReview, industryGroups, periodColumns, reviews]);

  const saveReviews = useCallback(async (nextReviews: IndustryWeeklyReview[]) => {
    const meaningful = dedupeReviews(nextReviews).filter(hasReviewContent);
    setIsSaving(true);
    setErrorText('');
    try {
      if (meaningful.length === 0) {
        setStatusText('没有需要保存的内容');
        return;
      }
      const result = await trackerApi.saveWeeklyReviews(meaningful);
      const savedByKey = new Map(result.reviews.map((review) => [reviewKey(review), review]));
      if (savedByKey.size > 0) {
        setReviews((current) => dedupeReviews([
          ...current.map((review) => savedByKey.get(reviewKey(review)) || review),
          ...result.reviews,
        ]));
      }
      setDirty(false);
      setStatusText(`已保存 ${result.reviews.length} 条`);
    } catch (error: any) {
      setErrorText(error?.message || '周评保存失败');
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handleSave = useCallback(() => {
    void saveReviews(collectVisibleReviews());
  }, [collectVisibleReviews, saveReviews]);

  const handleGenerate = useCallback(async () => {
    if (industries.length === 0 || !currentWeek) {
      setErrorText('没有可生成的行业');
      return;
    }

    setIsGenerating(true);
    setStatusText('');
    setErrorText('');

    try {
      const feedResult = await feedApi.list({ page: 1, pageSize: 200 });
      const selectedFeeds = selectFeedsForWeek(feedResult.data, currentWeek.start, currentWeek.end);
      const config = getApiConfig();
      const model = config.weeklySummaryModel || config.summaryModel || 'gemini-3-flash-preview';
      let output = '';

      for await (const event of aiApi.chatStream({
        model,
        systemPrompt: '你是买方工业研究员，擅长从周报和信息流中提取观点、需求、价格、供给、库存、产能和风险信号。严格输出 JSON。',
        messages: [{ role: 'user', content: buildGenerationPrompt(industries, selectedFeeds, currentWeek.start, currentWeek.end) }],
      })) {
        if (event.type === 'text' && event.content) output += event.content;
      }

      const parsed = extractJsonObject(output);
      const generated = Array.isArray(parsed.reviews) ? parsed.reviews : (parsed.industries || []);
      const sourceFeedIds = selectedFeeds.map((item) => item.id);
      const sourceTitles = selectedFeeds.slice(0, 12).map((item) => item.title);
      const aiGeneratedAt = Date.now();
      const byKey = new Map(reviews.map((review) => [reviewKey(review), review]));

      for (const industry of industries) {
        const next = findGeneratedForIndustry(industry.name, generated);
        if (!next) continue;
        const key = reviewKeyFromParts('week', currentWeek.key, industry.name);
        const base = byKey.get(key) || makeDraftReview(industry, currentWeek);
        byKey.set(key, {
          ...base,
          rating: normalizeRating(next.rating),
          summary: String(next.summary || '').trim(),
          demand: String(next.demand || '').trim(),
          supplyDemandSignals: normalizeArray(next.supplyDemandSignals),
          watchPoints: normalizeArray(next.watchPoints),
          sourceFeedIds,
          sourceTitles,
          aiGeneratedAt,
          updatedAt: aiGeneratedAt,
        });
      }

      const nextReviews = Array.from(byKey.values());
      setReviews(nextReviews);
      setDirty(true);
      await saveReviews(nextReviews);
      setStatusText(`AI 已生成 ${currentWeek.label} 周评，使用 ${selectedFeeds.length} 条信息流`);
    } catch (error: any) {
      setErrorText(error?.message || 'AI 生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [currentWeek, industries, reviews, saveReviews]);

  const handleCodexDirect = useCallback(async () => {
    if (industries.length === 0 || !currentWeek) {
      setErrorText('没有可生成的行业');
      return;
    }

    setIsDirectPreparing(true);
    setStatusText('');
    setErrorText('');

    try {
      const instruction = `请用 Research Canvas MCP 直接生成并写回行业周评。

目标周度：
- periodType: week
- weekStart: ${currentWeek.start}
- weekEnd: ${currentWeek.end}

步骤：
1. 调用 MCP 工具 industry_weekly_reviews_context，参数：
${JSON.stringify({
  weekStart: currentWeek.start,
  weekEnd: currentWeek.end,
  industryNames: industries.map((industry) => industry.name),
  feedPageSize: 200,
  maxFeedItems: 120,
  contentCharsPerItem: 16000,
  summaryReportsOnly: true,
  includeExisting: true,
}, null, 2)}

2. 基于返回的 feedItems 和 existingReviews 生成 reviews。不要为没有直接证据的行业编造中性占位。
3. 每条 review 保持紧凑：
   - periodType 写 "week"。
   - rating 只能是 "+"、"-"、"="。
   - summary 写行业观点。
   - demand 写需求/价格。
   - supplyDemandSignals 和 watchPoints 写其他跟踪。
   - sourceFeedIds/sourceTitles 填使用到的证据。
4. 调用 MCP 工具 industry_weekly_reviews_apply 写回 reviews。
5. 写回后告诉我：生成了哪些行业、跳过了哪些行业、主要依据是什么。`;

      await navigator.clipboard.writeText(instruction);
      setStatusText(`Codex Direct 指令已复制：${industries.length} 个行业，${currentWeek.start} 至 ${currentWeek.end}`);
    } catch (error: any) {
      setErrorText(error?.message || 'Codex Direct 指令复制失败');
    } finally {
      setIsDirectPreparing(false);
    }
  }, [currentWeek, industries]);

  const shiftWindow = useCallback((delta: number) => {
    if (viewMode === 'week') {
      setAnchorWeekStart((current) => addDays(current, delta * weekCount * 7));
      return;
    }
    setAnchorMonth((current) => addMonths(current, delta * monthCount));
  }, [monthCount, viewMode, weekCount]);

  const handleViewModeChange = useCallback((next: IndustryReviewPeriodType) => {
    setViewMode(next);
    if (next === 'month') setAnchorMonth(monthKeyFromDate(anchorWeekStart));
  }, [anchorWeekStart]);

  const addFutureMonth = useCallback(() => {
    setViewMode('month');
    setAnchorMonth((current) => addMonths(current, 1));
  }, []);

  const toggleIndustry = useCallback((industryName: string) => {
    const key = normalizeName(industryName);
    setCollapsedIndustries((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="mobile-scroll-container flex h-full min-h-0 flex-col bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <SegmentedToggle
              value={viewMode}
              onChange={handleViewModeChange}
              options={[
                { value: 'week', label: '周' },
                { value: 'month', label: '月' },
              ]}
            />
            <IconButton onClick={() => shiftWindow(-1)} title={viewMode === 'week' ? '上一组周' : '上一组月份'}>
              <ChevronLeft size={14} />
            </IconButton>
            <span className="text-xs text-slate-400">{viewMode === 'week' ? '截至' : '截至月'}</span>
            {viewMode === 'week' ? (
              <input
                type="date"
                value={anchorWeekStart}
                onChange={(event) => setAnchorWeekStart(toDateInputValue(startOfWeek(parseLocalDate(event.target.value))))}
                className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-400"
              />
            ) : (
              <input
                type="month"
                value={anchorMonth}
                onChange={(event) => setAnchorMonth(event.target.value || monthKeyFromDate(anchorWeekStart))}
                className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-400"
              />
            )}
            <IconButton onClick={() => shiftWindow(1)} title={viewMode === 'week' ? '下一组周' : '下一组月份'}>
              <ChevronRight size={14} />
            </IconButton>
            {viewMode === 'week' ? (
              <select
                value={weekCount}
                onChange={(event) => setWeekCount(Number(event.target.value))}
                className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none focus:border-blue-400"
              >
                <option value={1}>仅本周</option>
                <option value={8}>8 周</option>
                <option value={12}>12 周</option>
                <option value={16}>16 周</option>
              </select>
            ) : (
              <select
                value={monthCount}
                onChange={(event) => setMonthCount(Number(event.target.value))}
                className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none focus:border-blue-400"
              >
                <option value={3}>3 月</option>
                <option value={6}>6 月</option>
                <option value={9}>9 月</option>
                <option value={12}>12 月</option>
              </select>
            )}
            <select
              value={showOnlyWithContent ? 'reviewed' : 'all'}
              onChange={(event) => setShowOnlyWithContent(event.target.value === 'reviewed')}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none focus:border-blue-400"
            >
              <option value="reviewed">仅有内容</option>
              <option value="all">全部行业</option>
            </select>
            {viewMode === 'month' && (
              <button
                type="button"
                onClick={addFutureMonth}
                className="inline-flex h-7 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                title="显示并新建后一个月份列"
              >
                <Plus size={12} strokeWidth={2.5} />
                月份
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {dirty && <span className="text-[11px] text-amber-600">有未保存编辑</span>}
            {newFeedCount > 0 && (
              <button
                type="button"
                onClick={acknowledgeFeedUpdates}
                className="max-w-64 truncate rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                title={latestFeedTitle ? `最新推送：${latestFeedTitle}` : '发现新的信息流推送'}
              >
                新推送 {newFeedCount} 条
              </button>
            )}
            {newFeedCount === 0 && lastFeedCheckAt && (
              <span className="text-[10px] text-slate-400" title="后台每 90 秒检查一次信息流和周评更新">
                已检查 {formatShortTime(lastFeedCheckAt)}
              </span>
            )}
            {statusText && <span className="text-[11px] text-slate-500">{statusText}</span>}
            <IconButton onClick={() => loadReviews()} disabled={isLoading || isGenerating} title="刷新">
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </IconButton>
            <PrimaryButton
              variant="secondary"
              onClick={handleSave}
              disabled={isSaving || isGenerating}
              icon={isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            >
              保存
            </PrimaryButton>
            <PrimaryButton
              onClick={handleGenerate}
              disabled={isGenerating || isDirectPreparing || isSaving || industries.length === 0}
              icon={isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            >
              AI 生成当前周
            </PrimaryButton>
            <PrimaryButton
              variant="secondary"
              onClick={handleCodexDirect}
              disabled={isGenerating || isDirectPreparing || isSaving || industries.length === 0}
              icon={isDirectPreparing ? <Loader2 size={12} className="animate-spin" /> : <Clipboard size={12} />}
            >
              Codex Direct
            </PrimaryButton>
          </div>
        </div>

        {errorText && (
          <div className="mt-2 flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            <AlertTriangle size={13} />
            {errorText}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="h-full overflow-hidden rounded border border-slate-200 bg-white">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 size={15} className="animate-spin" />
              正在加载周评
            </div>
          ) : (
            <div className="h-full overflow-auto">
              <table className="w-max min-w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 w-44 min-w-44 border-b border-r border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                      行业 / 公司
                    </th>
                    {periodColumns.map((period) => (
                      <th
                        key={`${period.type}-${period.key}`}
                        className="sticky top-0 z-20 w-52 min-w-52 border-b border-r border-slate-200 bg-white px-2 py-1.5 text-center text-[11px] font-semibold text-slate-700 last:border-r-0"
                      >
                        <div>{period.label}</div>
                        <div className="font-normal text-slate-400">{period.subLabel}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {industryGroups.map((group) => {
                    const collapsed = collapsedIndustries.has(normalizeName(group.target.name));
                    return (
                      <Fragment key={group.target.name}>
                        <tr className="border-t border-slate-200 bg-slate-50">
                          <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-2 py-1.5">
                            <button
                              type="button"
                              onClick={() => toggleIndustry(group.target.name)}
                              className="flex w-full items-center gap-1.5 text-left"
                            >
                              <ChevronRight
                                size={13}
                                className={`shrink-0 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-90'}`}
                              />
                              <span className="truncate text-xs font-semibold text-slate-800">{group.target.name}</span>
                              {group.companies.length > 0 && (
                                <span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-400">
                                  {group.companies.length}
                                </span>
                              )}
                            </button>
                          </td>
                          {periodColumns.map((period) => (
                            <td key={`${group.target.name}-header-${period.key}`} className="border-r border-slate-100 bg-slate-50 px-2 py-1 text-[10px] text-slate-300 last:border-r-0" />
                          ))}
                        </tr>

                        {!collapsed && INDUSTRY_SECTION_ROWS.map((section) => (
                          <tr key={`${group.target.name}-${section.field}`} className="border-t border-slate-100 hover:bg-slate-50/40">
                            <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-2 align-top">
                              <div className="pl-5 text-xs font-medium text-slate-600">{section.label}</div>
                            </td>
                            {periodColumns.map((period) => (
                              <ReviewCell
                                key={`${group.target.name}-${section.field}-${period.key}`}
                                review={getCellReview(group.target, period)}
                                field={section.field}
                                onChange={updateReview}
                                onOpen={openReviewEditor}
                              />
                            ))}
                          </tr>
                        ))}

                        {!collapsed && group.companies.map((company) => (
                          <tr key={`${group.target.name}-${company.name}`} className="border-t border-slate-100 hover:bg-slate-50/40">
                            <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-2 align-top">
                              <div className="pl-5 text-xs text-slate-700">{company.name}</div>
                            </td>
                            {periodColumns.map((period) => (
                              <ReviewCell
                                key={`${group.target.name}-${company.name}-${period.key}`}
                                review={getCellReview(group.target, period, company)}
                                field="company"
                                onChange={updateReview}
                                onOpen={openReviewEditor}
                              />
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {industryGroups.length === 0 && (
                    <tr>
                      <td colSpan={periodColumns.length + 1} className="h-56 text-center text-xs text-slate-400">
                        暂无内容
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editingReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-4" onClick={() => setEditingReviewKey(null)}>
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {editingReview.companyName ? `${editingReview.industryName} / ${editingReview.companyName}` : editingReview.industryName}
                </div>
                <div className="text-[11px] text-slate-400">
                  {getReviewPeriodType(editingReview) === 'month'
                    ? formatMonthLabel(getReviewPeriodKey(editingReview))
                    : `${editingReview.weekStart} 至 ${editingReview.weekEnd}`}
                </div>
              </div>
              <IconButton onClick={() => setEditingReviewKey(null)} title="关闭">
                <X size={14} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="flex items-center gap-1">
                {RATING_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const active = editingReview.rating === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateReview(editingReview, { rating: option.value })}
                      className={`flex h-7 items-center gap-1 rounded border px-2 text-xs font-semibold transition-colors ${
                        active ? option.className : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      <Icon size={13} strokeWidth={2.8} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">观点</span>
                <textarea
                  value={editingReview.summary}
                  onChange={(event) => updateReview(editingReview, { summary: event.target.value })}
                  className="min-h-20 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">需求/价格</span>
                <textarea
                  value={cleanDemandText(editingReview.demand)}
                  onChange={(event) => updateReview(editingReview, { demand: event.target.value })}
                  className={`min-h-16 w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-xs leading-5 outline-none focus:border-blue-400 ${demandToneClass(editingReview.demand)}`}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">其他</span>
                <textarea
                  value={editingReview.userNotes || ''}
                  onChange={(event) => updateReview(editingReview, { userNotes: event.target.value })}
                  className="min-h-20 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                  placeholder={joinDistinct([...(editingReview.supplyDemandSignals || []), ...(editingReview.watchPoints || [])])}
                />
              </label>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">供需信号</span>
                  <textarea
                    value={editingReview.supplyDemandSignals.join('\n')}
                    onChange={(event) => updateReview(editingReview, { supplyDemandSignals: normalizeArray(event.target.value) })}
                    className="min-h-24 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">未来关注</span>
                  <textarea
                    value={editingReview.watchPoints.join('\n')}
                    onChange={(event) => updateReview(editingReview, { watchPoints: normalizeArray(event.target.value) })}
                    className="min-h-24 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                  />
                </label>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
              <PrimaryButton variant="secondary" onClick={() => setEditingReviewKey(null)}>
                关闭
              </PrimaryButton>
              <PrimaryButton onClick={handleSave} disabled={isSaving} icon={isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}>
                保存
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
