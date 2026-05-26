import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Trash2,
  X,
} from 'lucide-react';
import { aiApi, feedApi, trackerApi } from '../../db/apiClient.ts';
import type { FeedItem } from '../../db/apiClient.ts';
import type { IndustryReviewManualFields, IndustryWeeklyRating, IndustryWeeklyReview } from '../../types/index.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';
import { IconButton, PrimaryButton } from '../ui/index.ts';

export interface IndustryReviewTarget {
  name: string;
  workspaceId?: string;
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

interface WeekColumn {
  weekStart: string;
  weekEnd: string;
  label: string;
}

interface WatchItem {
  id: string;
  reviewId: string;
  watchIndex: number;
  industryName: string;
  weekStart: string;
  watchMonth: string;
  rating: IndustryWeeklyRating;
  point: string;
}

interface WatchDraft {
  industryName: string;
  month: string;
  rating: IndustryWeeklyRating;
  point: string;
}

const DEFAULT_WEEK_COLUMNS = 12;
const MAX_FALLBACK_FEEDS = 80;
const BOARD_REFRESH_INTERVAL_MS = 90_000;
const FEED_UPDATE_POLL_INTERVAL_MS = 90_000;

const RATING_OPTIONS: Array<{ value: IndustryWeeklyRating; icon: typeof Plus; label: string; className: string }> = [
  { value: '+', icon: Plus, label: '正向', className: 'border-emerald-600 bg-emerald-600 text-white shadow-sm' },
  { value: '=', icon: Equal, label: '中性', className: 'border-slate-900 bg-slate-900 text-white shadow-sm' },
  { value: '-', icon: Minus, label: '负向', className: 'border-red-600 bg-red-600 text-white shadow-sm' },
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

function buildMonthRange(startMonth: string, endMonth: string) {
  const months: string[] = [];
  if (!startMonth || !endMonth || startMonth > endMonth) return months;
  for (let current = startMonth; current <= endMonth; current = addMonths(current, 1)) {
    months.push(current);
  }
  return months;
}

function weekForMonth(weeks: WeekColumn[], monthKey: string, fallbackWeek: WeekColumn | undefined) {
  return (
    weeks.find((week) => monthKeyFromDate(week.weekStart) === monthKey || monthKeyFromDate(week.weekEnd) === monthKey) ||
    fallbackWeek ||
    weeks[weeks.length - 1]
  );
}

function watchPointWithMonth(monthKey: string, point: string) {
  const text = point.trim();
  if (!text) return '';
  if (/(20\d{2})\s*[\/\-年.]\s*(\d{1,2})/.test(text) || /(?:^|[^\d])(\d{1,2})\s*月/.test(text)) {
    return text;
  }
  return `${formatMonthLabel(monthKey)}：${text}`;
}

function inferYearForMonth(month: number, fallbackWeekStart: string) {
  const fallbackYear = Number(fallbackWeekStart.slice(0, 4)) || new Date().getFullYear();
  const fallbackMonth = Number(fallbackWeekStart.slice(5, 7)) || month;
  if (month <= 2 && fallbackMonth >= 10) return fallbackYear + 1;
  if (month >= 11 && fallbackMonth <= 2) return fallbackYear - 1;
  return fallbackYear;
}

function toMonthKey(year: string | number, month: string | number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function inferWatchMonth(point: string, fallbackWeekStart: string) {
  const explicitYearMonth = point.match(/(20\d{2})\s*[\/\-年.]\s*(\d{1,2})/);
  if (explicitYearMonth) {
    const [, year, month] = explicitYearMonth;
    return toMonthKey(year, month);
  }

  const monthText = point.match(/(?:^|[^\d])(\d{1,2})\s*月/);
  if (monthText) {
    const month = Number(monthText[1]);
    if (month >= 1 && month <= 12) return toMonthKey(inferYearForMonth(month, fallbackWeekStart), month);
  }

  const monthDay = point.match(/(?:^|[^\d])(\d{1,2})[\/\-](\d{1,2})(?:日)?(?:[^\d]|$)/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    if (month >= 1 && month <= 12) return toMonthKey(inferYearForMonth(month, fallbackWeekStart), month);
  }

  return monthKeyFromDate(fallbackWeekStart);
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

function reviewKey(review: Pick<IndustryWeeklyReview, 'weekStart' | 'industryName'>) {
  return `${review.weekStart}::${review.industryName}`;
}

function makeDraftReview(target: IndustryReviewTarget, weekStart: string, weekEnd: string): IndustryWeeklyReview {
  return {
    id: `draft-${weekStart}-${normalizeName(target.name) || target.name}`,
    industryName: target.name,
    workspaceId: target.workspaceId,
    weekStart,
    weekEnd,
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

function makeDraftManualFields(target: IndustryReviewTarget): IndustryReviewManualFields {
  return {
    id: `manual-${normalizeName(target.name) || target.name}`,
    industryName: target.name,
    workspaceId: target.workspaceId,
    longTermThesis: '',
    demandChange: '',
    catalyst: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
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

function hasManualFieldContent(fields?: IndustryReviewManualFields) {
  return Boolean(
    fields &&
      (fields.longTermThesis.trim() ||
        fields.demandChange.trim() ||
        fields.catalyst.trim()),
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

function mergeManualFieldsWithTargets(
  targets: IndustryReviewTarget[],
  saved: IndustryReviewManualFields[],
) {
  const savedByName = new Map(saved.map((fields) => [normalizeName(fields.industryName), fields]));
  const byName = new Map<string, IndustryReviewManualFields>();

  for (const target of targets) {
    const existing = savedByName.get(normalizeName(target.name));
    byName.set(normalizeName(target.name), existing
      ? { ...makeDraftManualFields(target), ...existing, workspaceId: target.workspaceId || existing.workspaceId }
      : makeDraftManualFields(target));
  }

  for (const fields of saved) {
    const key = normalizeName(fields.industryName);
    if (!byName.has(key)) byName.set(key, fields);
  }

  return Array.from(byName.values());
}

function buildWeekColumns(anchorWeekStart: string, count: number): WeekColumn[] {
  return Array.from({ length: count }, (_, index) => {
    const weekStart = addDays(anchorWeekStart, (index - count + 1) * 7);
    return {
      weekStart,
      weekEnd: addDays(weekStart, 6),
      label: formatWeekLabel(weekStart),
    };
  });
}

function mergeSavedWithTargets(
  targets: IndustryReviewTarget[],
  saved: IndustryWeeklyReview[],
  weeks: WeekColumn[],
) {
  const savedByKey = new Map(saved.map((review) => [`${review.weekStart}::${normalizeName(review.industryName)}`, review]));
  const targetOrder = new Map(targets.map((target, index) => [normalizeName(target.name), index]));
  const byName = new Map<string, IndustryReviewTarget>();

  for (const target of targets) byName.set(normalizeName(target.name), target);
  for (const review of saved) {
    const key = normalizeName(review.industryName);
    if (!byName.has(key)) byName.set(key, { name: review.industryName, workspaceId: review.workspaceId });
  }

  return Array.from(byName.values())
    .sort((a, b) => {
      const aOrder = targetOrder.get(normalizeName(a.name)) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = targetOrder.get(normalizeName(b.name)) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    })
    .flatMap((target) =>
      weeks.map((week) => {
        const existing = savedByKey.get(`${week.weekStart}::${normalizeName(target.name)}`);
        return existing
          ? { ...makeDraftReview(target, week.weekStart, week.weekEnd), ...existing, workspaceId: target.workspaceId || existing.workspaceId }
          : makeDraftReview(target, week.weekStart, week.weekEnd);
      }),
    );
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
- demand 只评价需求状态。
- supplyDemandSignals 写 1-3 条供需信号，优先写订单/价格/库存/产能/供给限制/交付/政策传导。
- watchPoints 写 1-3 条未来需要注意的提示，必须把事件/关注发生月份写在开头，格式为 "YYYY-MM：提示" 或 "M月：提示"；不要使用周报创建日期作为提示时间。
- rating 只能是 "+"、"-" 或 "="：+ 表示基本面或需求边际改善，- 表示恶化或风险上升，= 表示中性/证据不足/变化不大。
- 如果证据只是间接相关，除非周报明确给出强方向，否则 rating 用 "="。

JSON schema:
{
  "reviews": [
    {
      "industryName": "必须与行业列表一致",
      "summary": "一到两句话",
      "demand": "需求评价",
      "supplyDemandSignals": ["信号1"],
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

export const IndustryWeeklyReviewBoard = memo(function IndustryWeeklyReviewBoard({
  industries,
}: {
  industries: IndustryReviewTarget[];
}) {
  const [anchorWeekStart, setAnchorWeekStart] = useState(() => toDateInputValue(startOfWeek(new Date())));
  const [weekCount, setWeekCount] = useState(DEFAULT_WEEK_COLUMNS);
  const [showOnlyWithContent, setShowOnlyWithContent] = useState(true);
  const weeks = useMemo(() => buildWeekColumns(anchorWeekStart, weekCount), [anchorWeekStart, weekCount]);
  const currentWeek = weeks[weeks.length - 1];
  const [reviews, setReviews] = useState<IndustryWeeklyReview[]>([]);
  const [manualFields, setManualFields] = useState<IndustryReviewManualFields[]>([]);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editingWatchItemId, setEditingWatchItemId] = useState<string | null>(null);
  const [editingWatchText, setEditingWatchText] = useState('');
  const [isWatchTimelineExpanded, setIsWatchTimelineExpanded] = useState(false);
  const [watchDraft, setWatchDraft] = useState<WatchDraft | null>(null);
  const [isDirectPreparing, setIsDirectPreparing] = useState(false);
  const [newFeedCount, setNewFeedCount] = useState(0);
  const [latestFeedTitle, setLatestFeedTitle] = useState('');
  const [lastFeedCheckAt, setLastFeedCheckAt] = useState<number | null>(null);
  const feedBaselineRef = useRef<number | null>(null);
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const manualFieldsByName = useMemo(() => {
    return new Map(manualFields.map((fields) => [normalizeName(fields.industryName), fields]));
  }, [manualFields]);

  const rows = useMemo(() => {
    const industryOrder = new Map(industries.map((industry, index) => [normalizeName(industry.name), index]));
    const map = new Map<string, { industryName: string; cells: Map<string, IndustryWeeklyReview> }>();
    for (const review of reviews) {
      const key = normalizeName(review.industryName);
      if (!map.has(key)) map.set(key, { industryName: review.industryName, cells: new Map() });
      map.get(key)!.cells.set(review.weekStart, review);
    }
    const orderedRows = Array.from(map.values()).sort((a, b) => {
      const aOrder = industryOrder.get(normalizeName(a.industryName)) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = industryOrder.get(normalizeName(b.industryName)) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.industryName.localeCompare(b.industryName, 'zh-Hans-CN');
    });
    if (!showOnlyWithContent) return orderedRows;
    return orderedRows.filter((row) =>
      hasManualFieldContent(manualFieldsByName.get(normalizeName(row.industryName))) ||
        weeks.some((week) => {
          const review = row.cells.get(week.weekStart);
          return review ? hasReviewContent(review) : false;
        }),
    );
  }, [industries, manualFieldsByName, reviews, showOnlyWithContent, weeks]);

  const editingReview = useMemo(
    () => reviews.find((review) => review.id === editingReviewId) || null,
    [editingReviewId, reviews],
  );

  const defaultWatchMonth = currentWeek ? monthKeyFromDate(currentWeek.weekStart) : monthKeyFromDate(toDateInputValue(new Date()));

  const watchIndustryOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const row of rows) options.set(normalizeName(row.industryName), row.industryName);
    for (const industry of industries) options.set(normalizeName(industry.name), industry.name);
    for (const review of reviews) options.set(normalizeName(review.industryName), review.industryName);
    return Array.from(options.values());
  }, [industries, reviews, rows]);

  const loadReviews = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setIsLoading(true);
      setErrorText('');
    }
    try {
      const [savedByWeek, savedManualFields] = await Promise.all([
        Promise.all(weeks.map((week) => trackerApi.getWeeklyReviews({ weekStart: week.weekStart }))),
        trackerApi.getIndustryReviewFields(),
      ]);
      if (silent && dirtyRef.current) return;
      setReviews(mergeSavedWithTargets(industries, savedByWeek.flat(), weeks));
      setManualFields(mergeManualFieldsWithTargets(industries, savedManualFields));
      setDirty(false);
    } catch (error: any) {
      if (!silent) setErrorText(error?.message || '周评加载失败');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [industries, weeks]);

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

  const watchItems = useMemo<WatchItem[]>(() => {
    return reviews.flatMap((review) =>
      review.watchPoints.map((point, index) => ({
        id: `${review.id}-${index}-${point}`,
        reviewId: review.id,
        watchIndex: index,
        industryName: review.industryName,
        weekStart: review.weekStart,
        watchMonth: inferWatchMonth(point, review.weekStart),
        rating: review.rating,
        point,
      })),
    ).sort((a, b) => a.watchMonth.localeCompare(b.watchMonth) || a.industryName.localeCompare(b.industryName));
  }, [reviews]);

  const watchMonthColumns = useMemo(() => {
    const monthKeys = new Set<string>();
    for (const week of weeks) {
      monthKeys.add(monthKeyFromDate(week.weekStart));
      monthKeys.add(monthKeyFromDate(week.weekEnd));
    }
    for (const item of watchItems) monthKeys.add(item.watchMonth);
    const sorted = Array.from(monthKeys).sort();
    if (!sorted.length) return [];
    return buildMonthRange(sorted[0], sorted[sorted.length - 1]);
  }, [watchItems, weeks]);

  const watchTimeline = useMemo(() => {
    const groups = new Map<string, WatchItem[]>();
    for (const item of watchItems) {
      const bucket = groups.get(item.watchMonth) || [];
      bucket.push(item);
      groups.set(item.watchMonth, bucket);
    }
    return watchMonthColumns.map((month) => ({ month, items: groups.get(month) || [] }));
  }, [watchItems, watchMonthColumns]);

  const watchRows = useMemo(() => {
    const industryOrder = new Map(industries.map((industry, index) => [normalizeName(industry.name), index]));
    const groups = new Map<string, { industryName: string; itemsByMonth: Map<string, WatchItem[]>; count: number }>();
    const ensureGroup = (industryName: string) => {
      const key = normalizeName(industryName);
      if (!groups.has(key)) groups.set(key, { industryName, itemsByMonth: new Map(), count: 0 });
      return groups.get(key)!;
    };
    for (const row of rows) {
      ensureGroup(row.industryName);
    }
    for (const item of watchItems) {
      const group = ensureGroup(item.industryName);
      const bucket = group.itemsByMonth.get(item.watchMonth) || [];
      bucket.push(item);
      group.itemsByMonth.set(item.watchMonth, bucket);
      group.count += 1;
    }
    return Array.from(groups.values()).sort((a, b) => {
      const aOrder = industryOrder.get(normalizeName(a.industryName)) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = industryOrder.get(normalizeName(b.industryName)) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.industryName.localeCompare(b.industryName, 'zh-Hans-CN');
    });
  }, [industries, rows, watchItems]);

  const updateReview = useCallback((id: string, patch: Partial<IndustryWeeklyReview>) => {
    setReviews((current) =>
      current.map((review) => (review.id === id ? { ...review, ...patch, updatedAt: Date.now() } : review)),
    );
    setDirty(true);
  }, []);

  const startEditWatchItem = useCallback((item: WatchItem) => {
    setEditingWatchItemId(item.id);
    setEditingWatchText(item.point);
  }, []);

  const cancelEditWatchItem = useCallback(() => {
    setEditingWatchItemId(null);
    setEditingWatchText('');
  }, []);

  const saveWatchItem = useCallback((item: WatchItem) => {
    const nextText = editingWatchText.trim();
    if (!nextText) return;
    setReviews((current) =>
      current.map((review) => {
        if (review.id !== item.reviewId) return review;
        const nextWatchPoints = [...review.watchPoints];
        nextWatchPoints[item.watchIndex] = nextText;
        return { ...review, watchPoints: nextWatchPoints, updatedAt: Date.now() };
      }),
    );
    setDirty(true);
    setEditingWatchItemId(null);
    setEditingWatchText('');
  }, [editingWatchText]);

  const deleteWatchItem = useCallback((item: WatchItem) => {
    setReviews((current) =>
      current.map((review) => {
        if (review.id !== item.reviewId) return review;
        return {
          ...review,
          watchPoints: review.watchPoints.filter((_, index) => index !== item.watchIndex),
          updatedAt: Date.now(),
        };
      }),
    );
    setDirty(true);
    if (editingWatchItemId === item.id) cancelEditWatchItem();
  }, [cancelEditWatchItem, editingWatchItemId]);

  const openAddWatchItem = useCallback((month?: string, industryName?: string) => {
    setWatchDraft({
      industryName: industryName || watchIndustryOptions[0] || '',
      month: month || defaultWatchMonth,
      rating: '=',
      point: '',
    });
    setIsWatchTimelineExpanded(true);
    setErrorText('');
  }, [defaultWatchMonth, watchIndustryOptions]);

  const addWatchItem = useCallback(() => {
    if (!watchDraft) return;
    const industryName = watchDraft.industryName.trim();
    const month = watchDraft.month || defaultWatchMonth;
    const point = watchPointWithMonth(month, watchDraft.point);
    const selectedWeek = weekForMonth(weeks, month, currentWeek);
    if (!industryName || !month || !point || !selectedWeek) {
      setErrorText('请选择行业、月份并输入关注内容');
      return;
    }

    const target =
      industries.find((industry) => normalizeName(industry.name) === normalizeName(industryName)) ||
      { name: industryName };
    const targetKey = normalizeName(industryName);
    setReviews((current) => {
      let matched = false;
      const next = current.map((review) => {
        if (review.weekStart !== selectedWeek.weekStart || normalizeName(review.industryName) !== targetKey) return review;
        matched = true;
        return {
          ...review,
          rating: watchDraft.rating,
          watchPoints: [...review.watchPoints, point],
          updatedAt: Date.now(),
        };
      });
      if (matched) return next;
      return [
        ...next,
        {
          ...makeDraftReview(target, selectedWeek.weekStart, selectedWeek.weekEnd),
          rating: watchDraft.rating,
          watchPoints: [point],
          updatedAt: Date.now(),
        },
      ];
    });
    setDirty(true);
    setStatusText('已新增未来关注提示，记得保存');
    setWatchDraft(null);
  }, [currentWeek, defaultWatchMonth, industries, watchDraft, weeks]);

  const updateManualField = useCallback((industryName: string, patch: Partial<IndustryReviewManualFields>) => {
    setManualFields((current) => {
      const key = normalizeName(industryName);
      const existing = current.find((fields) => normalizeName(fields.industryName) === key);
      const fallbackTarget = industries.find((industry) => normalizeName(industry.name) === key) || { name: industryName };
      if (!existing) {
        return [...current, { ...makeDraftManualFields(fallbackTarget), ...patch, updatedAt: Date.now() }];
      }
      return current.map((fields) =>
        normalizeName(fields.industryName) === key ? { ...fields, ...patch, updatedAt: Date.now() } : fields,
      );
    });
    setDirty(true);
  }, [industries]);

  const saveReviews = useCallback(async (nextReviews: IndustryWeeklyReview[]) => {
    const meaningful = nextReviews.filter(hasReviewContent);
    const manualPayload = mergeManualFieldsWithTargets(industries, manualFields);
    setIsSaving(true);
    setErrorText('');
    try {
      if (meaningful.length === 0 && manualPayload.length === 0) {
        setStatusText('没有需要保存的内容');
        return;
      }
      const [reviewResult, manualResult] = await Promise.all([
        meaningful.length > 0 ? trackerApi.saveWeeklyReviews(meaningful) : Promise.resolve({ reviews: [] }),
        manualPayload.length > 0 ? trackerApi.saveIndustryReviewFields(manualPayload) : Promise.resolve({ fields: [] }),
      ]);
      const savedByKey = new Map(reviewResult.reviews.map((review) => [reviewKey(review), review]));
      const savedManualByName = new Map(manualResult.fields.map((fields) => [normalizeName(fields.industryName), fields]));
      if (savedByKey.size > 0) {
        setReviews((current) => current.map((review) => savedByKey.get(reviewKey(review)) || review));
      }
      if (savedManualByName.size > 0) {
        setManualFields((current) =>
          current.map((fields) => savedManualByName.get(normalizeName(fields.industryName)) || fields),
        );
      }
      setDirty(false);
      setStatusText(`已保存 ${reviewResult.reviews.length} 条周评 / ${manualResult.fields.length} 行手写列`);
    } catch (error: any) {
      setErrorText(error?.message || '周评保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [industries, manualFields]);

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
      const selectedFeeds = selectFeedsForWeek(feedResult.data, currentWeek.weekStart, currentWeek.weekEnd);
      const config = getApiConfig();
      const model = config.weeklySummaryModel || config.summaryModel || 'gemini-3-flash-preview';
      let output = '';

      for await (const event of aiApi.chatStream({
        model,
        systemPrompt: '你是买方工业研究员，擅长从周报和信息流中提取需求、供给、价格、库存、产能和风险信号。严格输出 JSON。',
        messages: [{ role: 'user', content: buildGenerationPrompt(industries, selectedFeeds, currentWeek.weekStart, currentWeek.weekEnd) }],
      })) {
        if (event.type === 'text' && event.content) output += event.content;
      }

      const parsed = extractJsonObject(output);
      const generated = Array.isArray(parsed.reviews) ? parsed.reviews : (parsed.industries || []);
      const sourceFeedIds = selectedFeeds.map((item) => item.id);
      const sourceTitles = selectedFeeds.slice(0, 12).map((item) => item.title);
      const aiGeneratedAt = Date.now();

      const nextReviews = reviews.map((review) => {
        if (review.weekStart !== currentWeek.weekStart) return review;
        const next = findGeneratedForIndustry(review.industryName, generated);
        if (!next) return review;
        return {
          ...review,
          rating: normalizeRating(next.rating),
          summary: String(next.summary || '').trim(),
          demand: String(next.demand || '').trim(),
          supplyDemandSignals: normalizeArray(next.supplyDemandSignals),
          watchPoints: normalizeArray(next.watchPoints),
          sourceFeedIds,
          sourceTitles,
          aiGeneratedAt,
          updatedAt: aiGeneratedAt,
        };
      });

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
- weekStart: ${currentWeek.weekStart}
- weekEnd: ${currentWeek.weekEnd}

步骤：
1. 调用 MCP 工具 industry_weekly_reviews_context，参数：
${JSON.stringify({
  weekStart: currentWeek.weekStart,
  weekEnd: currentWeek.weekEnd,
  industryNames: industries.map((industry) => industry.name),
  feedPageSize: 200,
  maxFeedItems: 120,
  contentCharsPerItem: 16000,
  summaryReportsOnly: true,
  includeExisting: true,
}, null, 2)}

2. 基于返回的 feedItems 和 existingReviews 生成 reviews。不要为没有直接证据的行业编造中性占位。
3. 每条 review 保持紧凑：
   - rating 只能是 "+"、"-"、"="。
   - summary 1-2 句。
   - demand 1 句，只写需求状态。
   - supplyDemandSignals 1-3 条。
   - watchPoints 必须写事件发生月份，优先格式 "YYYY-MM：提示"，不要用周报创建日期代替。
   - sourceFeedIds/sourceTitles 填使用到的证据。
4. 调用 MCP 工具 industry_weekly_reviews_apply 写回 reviews。
5. 写回后告诉我：生成了哪些行业、跳过了哪些行业、主要依据是什么。`;

      await navigator.clipboard.writeText(instruction);
      setStatusText(`Codex Direct 指令已复制：${industries.length} 个行业，${currentWeek.weekStart} 至 ${currentWeek.weekEnd}`);
    } catch (error: any) {
      setErrorText(error?.message || 'Codex Direct 指令复制失败');
    } finally {
      setIsDirectPreparing(false);
    }
  }, [currentWeek, industries]);

  const shiftWindow = useCallback((deltaWeeks: number) => {
    setAnchorWeekStart((current) => addDays(current, deltaWeeks * 7));
  }, []);

  return (
    <div className="mobile-scroll-container flex h-full min-h-0 flex-col bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <IconButton onClick={() => shiftWindow(-weekCount)} title="上一组周">
              <ChevronLeft size={14} />
            </IconButton>
            <span className="text-xs text-slate-400">截至</span>
            <input
              type="date"
              value={anchorWeekStart}
              onChange={(event) => setAnchorWeekStart(toDateInputValue(startOfWeek(parseLocalDate(event.target.value))))}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-400"
            />
            <IconButton onClick={() => shiftWindow(weekCount)} title="下一组周">
              <ChevronRight size={14} />
            </IconButton>
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
            <select
              value={showOnlyWithContent ? 'reviewed' : 'all'}
              onChange={(event) => setShowOnlyWithContent(event.target.value === 'reviewed')}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none focus:border-blue-400"
            >
              <option value="reviewed">仅有观点</option>
              <option value="all">全部行业</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
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
              onClick={() => saveReviews(reviews)}
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex w-full items-center justify-between gap-3 hover:bg-slate-50">
            <button
              type="button"
              onClick={() => setIsWatchTimelineExpanded((current) => !current)}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
            >
              <ChevronRight
                size={14}
                className={`shrink-0 text-slate-400 transition-transform ${isWatchTimelineExpanded ? 'rotate-90' : ''}`}
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-700">未来关注提示（月度时间轴）</div>
                <div className="text-[10px] text-slate-400">{watchItems.length} 条 / {watchRows.length} 个行业 / 按事件月份</div>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-2 pr-3">
              <button
                type="button"
                onClick={() => openAddWatchItem()}
                className="inline-flex h-7 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                title="新增未来关注提示"
              >
                <Plus size={12} strokeWidth={2.5} />
                新增
              </button>
              <button
                type="button"
                onClick={() => setIsWatchTimelineExpanded((current) => !current)}
                className="text-[10px] font-medium text-slate-400 hover:text-slate-600"
              >
                {isWatchTimelineExpanded ? '收起' : '展开'}
              </button>
            </div>
          </div>
          {!isWatchTimelineExpanded ? (
            <div className="border-t border-slate-100 px-3 py-2">
              {watchTimeline.some((group) => group.items.length) ? (
                <div className="flex flex-wrap gap-1.5">
                  {watchTimeline
                    .filter((group) => group.items.length)
                    .slice(0, 6)
                    .map((group) => (
                      <span key={`watch-summary-${group.month}`} className="rounded-full bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                        {formatMonthLabel(group.month)} · {group.items.length}
                      </span>
                    ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400">暂无提示</div>
              )}
            </div>
          ) : watchRows.length === 0 ? (
            <div className="flex h-20 items-center justify-center border-t border-slate-100">
              <button
                type="button"
                onClick={() => openAddWatchItem()}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                <Plus size={13} />
                新增提示
              </button>
            </div>
          ) : (
            <div className="max-h-80 overflow-auto border-t border-slate-100 px-3 py-3">
              <table className="w-max min-w-full border-collapse overflow-hidden rounded border border-slate-100 text-left">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 w-40 min-w-40 border-b border-r border-slate-100 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-700">
                      行业
                    </th>
                    {watchTimeline.map((group) => (
                      <th key={`watch-month-${group.month}`} className="sticky top-0 z-10 w-56 min-w-56 border-b border-r border-slate-100 bg-slate-50 px-2 py-1.5 last:border-r-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-700">{formatMonthLabel(group.month)}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openAddWatchItem(group.month)}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                              title={`新增 ${formatMonthLabel(group.month)} 提示`}
                            >
                              <Plus size={11} strokeWidth={2.5} />
                            </button>
                            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-400">{group.items.length}</span>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {watchRows.map((row) => (
                    <tr key={`watch-row-${row.industryName}`} className="border-b border-slate-100 last:border-b-0">
                      <td className="sticky left-0 z-10 w-40 min-w-40 border-r border-slate-100 bg-white px-2 py-2 align-top">
                        <div className="text-xs font-semibold leading-4 text-slate-700">{row.industryName}</div>
                        <div className="mt-1 text-[10px] text-slate-400">{row.count} 条</div>
                      </td>
                      {watchMonthColumns.map((month) => {
                        const items = row.itemsByMonth.get(month) || [];
                        return (
                          <td key={`${row.industryName}-${month}`} className="w-56 min-w-56 border-r border-slate-100 bg-white px-2 py-1.5 align-top last:border-r-0">
                            {items.length ? (
                              <div className="space-y-1">
                                {items.map((item) => {
                                  const rating = RATING_OPTIONS.find((option) => option.value === item.rating) || RATING_OPTIONS[1];
                                  const RatingIcon = rating.icon;
                                  const isEditing = editingWatchItemId === item.id;
                                  return (
                                    <div key={item.id} className="rounded bg-slate-50 px-2 py-1 shadow-sm ring-1 ring-slate-100">
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="truncate text-[10px] font-medium text-slate-500">{formatWeekLabel(item.weekStart)}</span>
                                        <div className="flex shrink-0 items-center gap-1">
                                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${rating.className}`} title={rating.label}>
                                            <RatingIcon size={10} strokeWidth={2.5} />
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => startEditWatchItem(item)}
                                            className="rounded p-0.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                                            title="编辑提示"
                                          >
                                            <Pencil size={11} strokeWidth={2.4} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => deleteWatchItem(item)}
                                            className="rounded p-0.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                                            title="删除提示"
                                          >
                                            <Trash2 size={11} strokeWidth={2.4} />
                                          </button>
                                        </div>
                                      </div>
                                      {isEditing ? (
                                        <div className="space-y-1">
                                          <textarea
                                            value={editingWatchText}
                                            onChange={(event) => setEditingWatchText(event.target.value)}
                                            className="h-16 w-full resize-none rounded border border-blue-200 bg-white px-1.5 py-1 text-[11px] leading-4 text-slate-700 outline-none focus:border-blue-500"
                                            autoFocus
                                          />
                                          <div className="flex justify-end gap-1">
                                            <button
                                              type="button"
                                              onClick={cancelEditWatchItem}
                                              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                                            >
                                              取消
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => saveWatchItem(item)}
                                              className="rounded border border-blue-500 bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-blue-700"
                                            >
                                              保存
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="line-clamp-3 text-[11px] leading-4 text-slate-700" title={item.point}>{item.point}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openAddWatchItem(month, row.industryName)}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-blue-50 hover:text-blue-700"
                                title={`给 ${row.industryName} 新增 ${formatMonthLabel(month)} 提示`}
                              >
                                <Plus size={10} strokeWidth={2.5} />
                                新增
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm max-md:overflow-auto">
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
                    <th className="sticky left-0 top-0 z-30 w-36 min-w-36 border-b border-slate-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                      行业
                    </th>
                    <th className="sticky top-0 z-20 w-44 min-w-44 border-b border-slate-100 bg-white px-2 py-2 text-xs font-semibold text-slate-600">
                      中长期投资逻辑
                    </th>
                    <th className="sticky top-0 z-20 w-40 min-w-40 border-b border-slate-100 bg-white px-2 py-2 text-xs font-semibold text-slate-600">
                      需求变化
                    </th>
                    <th className="sticky top-0 z-20 w-40 min-w-40 border-b border-slate-100 bg-white px-2 py-2 text-xs font-semibold text-slate-600">
                      催化
                    </th>
                    {weeks.map((week) => (
                      <th
                        key={week.weekStart}
                        className="sticky top-0 z-20 w-40 min-w-40 border-b border-slate-100 bg-white px-2 py-1.5 text-center text-[11px] font-semibold text-slate-600"
                      >
                        <div>{week.label}</div>
                        <div className="font-normal text-slate-400">{week.weekEnd.slice(5).replace('-', '/')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const manual = manualFieldsByName.get(normalizeName(row.industryName)) || makeDraftManualFields({ name: row.industryName });
                    return (
                      <tr key={row.industryName} className="border-b border-slate-100 hover:bg-slate-50/40">
                        <td className="sticky left-0 z-10 w-36 min-w-36 bg-white px-3 py-2 align-top">
                          <div className="text-xs font-semibold leading-5 text-slate-800">{row.industryName}</div>
                        </td>
                        <td className="w-44 min-w-44 bg-white p-1.5 align-top">
                          <textarea
                            value={manual.longTermThesis}
                            onChange={(event) => updateManualField(row.industryName, { longTermThesis: event.target.value })}
                            className="h-24 w-full resize-none rounded-lg border border-transparent bg-slate-50/60 px-2 py-1.5 text-[11px] leading-4 text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-blue-200 focus:bg-white focus:ring-1 focus:ring-blue-100"
                            placeholder="中长期逻辑"
                          />
                        </td>
                        <td className="w-40 min-w-40 bg-white p-1.5 align-top">
                          <textarea
                            value={manual.demandChange}
                            onChange={(event) => updateManualField(row.industryName, { demandChange: event.target.value })}
                            className="h-24 w-full resize-none rounded-lg border border-transparent bg-slate-50/60 px-2 py-1.5 text-[11px] leading-4 text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-blue-200 focus:bg-white focus:ring-1 focus:ring-blue-100"
                            placeholder="需求变化"
                          />
                        </td>
                        <td className="w-40 min-w-40 bg-white p-1.5 align-top">
                          <textarea
                            value={manual.catalyst}
                            onChange={(event) => updateManualField(row.industryName, { catalyst: event.target.value })}
                            className="h-24 w-full resize-none rounded-lg border border-transparent bg-slate-50/60 px-2 py-1.5 text-[11px] leading-4 text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-blue-200 focus:bg-white focus:ring-1 focus:ring-blue-100"
                            placeholder="催化"
                          />
                        </td>
                      {weeks.map((week) => {
                        const review = row.cells.get(week.weekStart);
                        if (!review) {
                          return (
                            <td key={week.weekStart} className="w-40 min-w-40 p-2 align-top text-xs text-slate-300">
                              -
                            </td>
                          );
                        }
                        const demandTone = demandToneClass(review.demand);
                        return (
                          <td key={review.id} className="w-40 min-w-40 bg-white p-1.5 align-top">
                            <div className="flex h-24 flex-col gap-1">
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-0.5">
                                  {RATING_OPTIONS.map((option) => {
                                    const Icon = option.icon;
                                    const active = review.rating === option.value;
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        title={option.label}
                                        onClick={() => updateReview(review.id, { rating: option.value })}
                                        className={`flex h-4 w-4 items-center justify-center rounded-full border font-semibold transition-colors ${
                                          active ? `${option.className} ring-1 ring-current/15` : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500 hover:bg-slate-100 hover:text-slate-800'
                                        }`}
                                      >
                                        <Icon size={9} strokeWidth={3} />
                                      </button>
                                    );
                                  })}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setEditingReviewId(review.id)}
                                  className="rounded p-0.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                                  title="编辑详情"
                                >
                                  <Pencil size={11} />
                                </button>
                              </div>
                              <textarea
                                value={review.summary}
                                onChange={(event) => updateReview(review.id, { summary: event.target.value })}
                                className="h-10 resize-none rounded-lg border border-transparent bg-slate-50/70 px-2 py-1 text-[11px] leading-4 text-slate-700 outline-none transition-colors hover:bg-slate-50 focus:border-blue-200 focus:bg-white focus:ring-1 focus:ring-blue-100"
                                placeholder="评价"
                              />
                              <input
                                value={cleanDemandText(review.demand)}
                                onChange={(event) => updateReview(review.id, { demand: event.target.value })}
                                className={`h-5 rounded-lg border border-transparent px-2 text-[11px] outline-none transition-colors focus:ring-1 focus:ring-blue-100 ${demandTone}`}
                                placeholder="需求"
                              />
                              <div className="flex min-w-0 items-center gap-1 text-[10px] text-slate-400">
                                <span className="truncate">{review.watchPoints[0] || review.supplyDemandSignals[0] || '无关注点'}</span>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={weeks.length + 4} className="h-56 text-center text-xs text-slate-400">
                        暂无周观点
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {watchDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-4" onClick={() => setWatchDraft(null)}>
          <div
            className="flex w-full max-w-lg flex-col overflow-hidden rounded bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">新增未来关注提示</div>
                <div className="text-[11px] text-slate-400">会写入对应行业的周评 watchPoints，保存后生效</div>
              </div>
              <IconButton onClick={() => setWatchDraft(null)} title="关闭">
                <X size={14} />
              </IconButton>
            </div>
            <div className="space-y-3 px-4 py-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">行业</span>
                  <select
                    value={watchDraft.industryName}
                    onChange={(event) => setWatchDraft((current) => current ? { ...current, industryName: event.target.value } : current)}
                    className="h-9 w-full rounded border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-blue-400"
                  >
                    {watchIndustryOptions.length === 0 && <option value="">暂无行业</option>}
                    {watchIndustryOptions.map((industryName) => (
                      <option key={`watch-option-${industryName}`} value={industryName}>{industryName}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">月份</span>
                  <input
                    type="month"
                    value={watchDraft.month}
                    onChange={(event) => setWatchDraft((current) => current ? { ...current, month: event.target.value || defaultWatchMonth } : current)}
                    className="h-9 w-full rounded border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-blue-400"
                  />
                </label>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-500">方向</span>
                <div className="flex items-center gap-1.5">
                  {RATING_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const active = watchDraft.rating === option.value;
                    return (
                      <button
                        key={`watch-draft-rating-${option.value}`}
                        type="button"
                        onClick={() => setWatchDraft((current) => current ? { ...current, rating: option.value } : current)}
                        className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-xs font-semibold transition-colors ${
                          active ? `${option.className} ring-1 ring-current/15` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
                        }`}
                      >
                        <Icon size={12} strokeWidth={2.6} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">内容</span>
                <textarea
                  value={watchDraft.point}
                  onChange={(event) => setWatchDraft((current) => current ? { ...current, point: event.target.value } : current)}
                  className="min-h-24 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-sm leading-5 text-slate-700 outline-none focus:border-blue-400"
                  placeholder="例如：跟踪 6 月订单、库存和价格传导。"
                  autoFocus
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
              <PrimaryButton variant="secondary" onClick={() => setWatchDraft(null)}>
                取消
              </PrimaryButton>
              <PrimaryButton onClick={addWatchItem} disabled={!watchDraft.industryName.trim() || !watchDraft.month || !watchDraft.point.trim()}>
                添加
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {editingReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-4" onClick={() => setEditingReviewId(null)}>
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">{editingReview.industryName}</div>
                <div className="text-[11px] text-slate-400">
                  {editingReview.weekStart} 至 {editingReview.weekEnd}
                </div>
              </div>
              <IconButton onClick={() => setEditingReviewId(null)} title="关闭">
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
                      onClick={() => updateReview(editingReview.id, { rating: option.value })}
                      className={`flex h-7 items-center gap-1 rounded border px-2 text-xs font-semibold transition-colors ${
                        active ? `${option.className} ring-1 ring-current/15` : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500 hover:bg-slate-100 hover:text-slate-800'
                      }`}
                    >
                      <Icon size={13} strokeWidth={2.8} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={editingReview.summary}
                onChange={(event) => updateReview(editingReview.id, { summary: event.target.value })}
                className="min-h-20 w-full resize-y rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400 focus:bg-white"
                placeholder="本周评价"
              />
              <textarea
                value={cleanDemandText(editingReview.demand)}
                onChange={(event) => updateReview(editingReview.id, { demand: event.target.value })}
                className={`min-h-14 w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-xs leading-5 outline-none ${demandToneClass(editingReview.demand)}`}
                placeholder="需求"
              />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <textarea
                  value={editingReview.supplyDemandSignals.join('\n')}
                  onChange={(event) => updateReview(editingReview.id, { supplyDemandSignals: normalizeArray(event.target.value) })}
                  className="min-h-24 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                  placeholder="供需信号"
                />
                <textarea
                  value={editingReview.watchPoints.join('\n')}
                  onChange={(event) => updateReview(editingReview.id, { watchPoints: normalizeArray(event.target.value) })}
                  className="min-h-24 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                  placeholder="未来关注"
                />
              </div>
              <textarea
                value={editingReview.userNotes || ''}
                onChange={(event) => updateReview(editingReview.id, { userNotes: event.target.value })}
                className="min-h-16 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                placeholder="我的补充"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
              <PrimaryButton variant="secondary" onClick={() => setEditingReviewId(null)}>
                关闭
              </PrimaryButton>
              <PrimaryButton onClick={() => saveReviews(reviews)} disabled={isSaving} icon={isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}>
                保存
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
