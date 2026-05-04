import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
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
import type { IndustryWeeklyRating, IndustryWeeklyReview } from '../../types/index.ts';
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

const DEFAULT_WEEK_COLUMNS = 12;

const RATING_OPTIONS: Array<{ value: IndustryWeeklyRating; icon: typeof Plus; label: string; className: string }> = [
  { value: '+', icon: Plus, label: '正向', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { value: '=', icon: Equal, label: '中性', className: 'text-slate-700 bg-slate-50 border-slate-200' },
  { value: '-', icon: Minus, label: '负向', className: 'text-red-700 bg-red-50 border-red-200' },
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

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/\r?\n|[；;]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeRating(value: unknown): IndustryWeeklyRating {
  return value === '+' || value === '-' || value === '=' ? value : '=';
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
  const byName = new Map<string, IndustryReviewTarget>();

  for (const target of targets) byName.set(normalizeName(target.name), target);
  for (const review of saved) {
    const key = normalizeName(review.industryName);
    if (!byName.has(key)) byName.set(key, { name: review.industryName, workspaceId: review.workspaceId });
  }

  return Array.from(byName.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
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

function selectFeedsForWeek(items: FeedItem[], weekStart: string, weekEnd: string) {
  const start = parseLocalDate(weekStart).getTime();
  const end = parseLocalDate(addDays(weekEnd, 1)).getTime();
  const inRange = items.filter((item) => {
    const time = feedTimestamp(item);
    return time >= start && time < end;
  });

  const source = inRange.length > 0 ? inRange : items.slice(0, 80);
  return source
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
    content: truncateText(item.content, item.type === 'weekly' ? 900 : 420),
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
- 必须覆盖行业列表里的每一个行业；信息不足时明确写“本周信息流没有足够新增证据”，不要编造。
- summary 是一到两句话的本周评价。
- demand 只评价需求状态。
- supplyDemandSignals 写 1-3 条供需信号，优先写订单/价格/库存/产能/供给限制/交付/政策传导。
- watchPoints 写 1-3 条未来需要注意的提示。
- rating 只能是 "+"、"-" 或 "="：+ 表示基本面或需求边际改善，- 表示恶化或风险上升，= 表示中性/证据不足/变化不大。

JSON schema:
{
  "reviews": [
    {
      "industryName": "必须与行业列表一致",
      "summary": "一到两句话",
      "demand": "需求评价",
      "supplyDemandSignals": ["信号1"],
      "watchPoints": ["提示1"],
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
  const weeks = useMemo(() => buildWeekColumns(anchorWeekStart, weekCount), [anchorWeekStart, weekCount]);
  const currentWeek = weeks[weeks.length - 1];
  const [reviews, setReviews] = useState<IndustryWeeklyReview[]>([]);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [dirty, setDirty] = useState(false);

  const rows = useMemo(() => {
    const map = new Map<string, { industryName: string; cells: Map<string, IndustryWeeklyReview> }>();
    for (const review of reviews) {
      const key = normalizeName(review.industryName);
      if (!map.has(key)) map.set(key, { industryName: review.industryName, cells: new Map() });
      map.get(key)!.cells.set(review.weekStart, review);
    }
    return Array.from(map.values()).sort((a, b) => a.industryName.localeCompare(b.industryName, 'zh-Hans-CN'));
  }, [reviews]);

  const editingReview = useMemo(
    () => reviews.find((review) => review.id === editingReviewId) || null,
    [editingReviewId, reviews],
  );

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    setErrorText('');
    try {
      const savedByWeek = await Promise.all(weeks.map((week) => trackerApi.getWeeklyReviews({ weekStart: week.weekStart })));
      setReviews(mergeSavedWithTargets(industries, savedByWeek.flat(), weeks));
      setDirty(false);
    } catch (error: any) {
      setErrorText(error?.message || '周评加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [industries, weeks]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const watchItems = useMemo(() => {
    return reviews.flatMap((review) =>
      review.watchPoints.map((point) => ({
        id: `${review.id}-${point}`,
        industryName: review.industryName,
        weekStart: review.weekStart,
        rating: review.rating,
        point,
      })),
    );
  }, [reviews]);

  const updateReview = useCallback((id: string, patch: Partial<IndustryWeeklyReview>) => {
    setReviews((current) =>
      current.map((review) => (review.id === id ? { ...review, ...patch, updatedAt: Date.now() } : review)),
    );
    setDirty(true);
  }, []);

  const saveReviews = useCallback(async (nextReviews: IndustryWeeklyReview[]) => {
    const meaningful = nextReviews.filter(hasReviewContent);
    setIsSaving(true);
    setErrorText('');
    try {
      if (meaningful.length === 0) {
        setStatusText('没有需要保存的周评');
        return;
      }
      const result = await trackerApi.saveWeeklyReviews(meaningful);
      const savedByKey = new Map(result.reviews.map((review) => [reviewKey(review), review]));
      setReviews((current) => current.map((review) => savedByKey.get(reviewKey(review)) || review));
      setDirty(false);
      setStatusText(`已保存 ${result.reviews.length} 条周评`);
    } catch (error: any) {
      setErrorText(error?.message || '周评保存失败');
    } finally {
      setIsSaving(false);
    }
  }, []);

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

  const shiftWindow = useCallback((deltaWeeks: number) => {
    setAnchorWeekStart((current) => addDays(current, deltaWeeks * 7));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
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
              <option value={8}>8 周</option>
              <option value={12}>12 周</option>
              <option value={16}>16 周</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            {dirty && <span className="text-[11px] text-amber-600">有未保存编辑</span>}
            {statusText && <span className="text-[11px] text-slate-500">{statusText}</span>}
            <IconButton onClick={loadReviews} disabled={isLoading || isGenerating} title="刷新">
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
              disabled={isGenerating || isSaving || industries.length === 0}
              icon={isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            >
              AI 生成当前周
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
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
                    <th className="sticky left-0 top-0 z-30 w-36 min-w-36 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                      行业
                    </th>
                    {weeks.map((week) => (
                      <th
                        key={week.weekStart}
                        className="sticky top-0 z-20 w-40 min-w-40 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-semibold text-slate-600"
                      >
                        <div>{week.label}</div>
                        <div className="font-normal text-slate-400">{week.weekEnd.slice(5).replace('-', '/')}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.industryName} className="border-b border-slate-100">
                      <td className="sticky left-0 z-10 w-36 min-w-36 border-r border-slate-200 bg-white px-3 py-2 align-top">
                        <div className="text-xs font-semibold leading-5 text-slate-800">{row.industryName}</div>
                      </td>
                      {weeks.map((week) => {
                        const review = row.cells.get(week.weekStart);
                        if (!review) {
                          return (
                            <td key={week.weekStart} className="w-40 min-w-40 border-r border-slate-100 p-2 align-top text-xs text-slate-300">
                              -
                            </td>
                          );
                        }
                        const rating = RATING_OPTIONS.find((option) => option.value === review.rating) || RATING_OPTIONS[1];
                        const RatingIcon = rating.icon;
                        return (
                          <td key={review.id} className="w-40 min-w-40 border-r border-slate-100 bg-white p-1.5 align-top">
                            <div className="flex h-28 flex-col gap-1">
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
                                        className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                                          active ? option.className : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                                        }`}
                                      >
                                        <Icon size={10} />
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
                                className="h-11 resize-none rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] leading-4 text-slate-700 outline-none focus:border-blue-400 focus:bg-white"
                                placeholder="评价"
                              />
                              <input
                                value={review.demand}
                                onChange={(event) => updateReview(review.id, { demand: event.target.value })}
                                className="h-5 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700 outline-none focus:border-blue-400"
                                placeholder="需求"
                              />
                              <div className="flex min-w-0 items-center gap-1 text-[10px] text-slate-400">
                                <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${rating.className}`}>
                                  <RatingIcon size={9} />
                                </span>
                                <span className="truncate">{review.watchPoints[0] || review.supplyDemandSignals[0] || '无关注点'}</span>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={weeks.length + 1} className="h-56 text-center text-xs text-slate-400">
                        暂无行业
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="text-xs font-semibold text-slate-700">未来关注提示</div>
            <div className="text-[10px] text-slate-400">{watchItems.length} 条 / 可见周</div>
          </div>
          <div className="h-full overflow-y-auto p-2 pb-14">
            {watchItems.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-xs text-slate-400">暂无提示</div>
            ) : (
              <div className="space-y-1.5">
                {watchItems.map((item) => (
                  <div key={item.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-medium text-slate-600">{item.industryName}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{formatWeekLabel(item.weekStart)}</span>
                    </div>
                    <div className="text-xs leading-5 text-slate-700">{item.point}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

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
                      className={`flex h-7 items-center gap-1 rounded border px-2 text-xs transition-colors ${
                        active ? option.className : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={12} />
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
                value={editingReview.demand}
                onChange={(event) => updateReview(editingReview.id, { demand: event.target.value })}
                className="min-h-14 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
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
