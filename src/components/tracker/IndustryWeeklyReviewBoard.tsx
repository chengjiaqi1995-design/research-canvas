import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Equal,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
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

function mergeSavedWithTargets(
  targets: IndustryReviewTarget[],
  saved: IndustryWeeklyReview[],
  weekStart: string,
  weekEnd: string,
) {
  const savedByName = new Map(saved.map((review) => [normalizeName(review.industryName), review]));
  const rows = targets.map((target) => {
    const existing = savedByName.get(normalizeName(target.name));
    return existing
      ? { ...makeDraftReview(target, weekStart, weekEnd), ...existing, workspaceId: target.workspaceId || existing.workspaceId }
      : makeDraftReview(target, weekStart, weekEnd);
  });

  const targetNames = new Set(targets.map((target) => normalizeName(target.name)));
  const extras = saved.filter((review) => !targetNames.has(normalizeName(review.industryName)));
  return [...rows, ...extras].sort((a, b) => a.industryName.localeCompare(b.industryName, 'zh-Hans-CN'));
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
  const [weekStart, setWeekStart] = useState(() => toDateInputValue(startOfWeek(new Date())));
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const [reviews, setReviews] = useState<IndustryWeeklyReview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [dirty, setDirty] = useState(false);

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    setErrorText('');
    try {
      const saved = await trackerApi.getWeeklyReviews({ weekStart });
      setReviews(mergeSavedWithTargets(industries, saved, weekStart, weekEnd));
      setDirty(false);
    } catch (error: any) {
      setErrorText(error?.message || '周评加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [industries, weekEnd, weekStart]);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const watchItems = useMemo(() => {
    return reviews.flatMap((review) =>
      review.watchPoints.map((point) => ({
        id: `${review.id}-${point}`,
        industryName: review.industryName,
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
      setReviews((current) =>
        current.map((review) => savedByKey.get(reviewKey(review)) || review),
      );
      setDirty(false);
      setStatusText(`已保存 ${result.reviews.length} 条周评`);
    } catch (error: any) {
      setErrorText(error?.message || '周评保存失败');
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (industries.length === 0) {
      setErrorText('没有可生成的行业');
      return;
    }

    setIsGenerating(true);
    setStatusText('');
    setErrorText('');

    try {
      const feedResult = await feedApi.list({ page: 1, pageSize: 200 });
      const selectedFeeds = selectFeedsForWeek(feedResult.data, weekStart, weekEnd);
      const config = getApiConfig();
      const model = config.weeklySummaryModel || config.summaryModel || 'gemini-3-flash-preview';
      let output = '';

      for await (const event of aiApi.chatStream({
        model,
        systemPrompt: '你是买方工业研究员，擅长从周报和信息流中提取需求、供给、价格、库存、产能和风险信号。严格输出 JSON。',
        messages: [{ role: 'user', content: buildGenerationPrompt(industries, selectedFeeds, weekStart, weekEnd) }],
      })) {
        if (event.type === 'text' && event.content) output += event.content;
      }

      const parsed = extractJsonObject(output);
      const generated = Array.isArray(parsed.reviews) ? parsed.reviews : (parsed.industries || []);
      const sourceFeedIds = selectedFeeds.map((item) => item.id);
      const sourceTitles = selectedFeeds.slice(0, 12).map((item) => item.title);
      const aiGeneratedAt = Date.now();

      const nextReviews = reviews.map((review) => {
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
      setStatusText(`AI 已生成 ${generated.length} 条周评，使用 ${selectedFeeds.length} 条信息流`);
    } catch (error: any) {
      setErrorText(error?.message || 'AI 生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [industries, reviews, saveReviews, weekEnd, weekStart]);

  const shiftWeek = useCallback((deltaWeeks: number) => {
    setWeekStart((current) => addDays(current, deltaWeeks * 7));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <IconButton onClick={() => shiftWeek(-1)} title="上一周">
              <ChevronLeft size={14} />
            </IconButton>
            <input
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(toDateInputValue(startOfWeek(parseLocalDate(event.target.value))))}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-400"
            />
            <span className="text-xs text-slate-400">至</span>
            <span className="min-w-20 text-xs font-medium text-slate-600">{weekEnd}</span>
            <IconButton onClick={() => shiftWeek(1)} title="下一周">
              <ChevronRight size={14} />
            </IconButton>
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
              AI 生成
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-h-0 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 size={15} className="animate-spin" />
              正在加载周评
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
              {reviews.map((review) => (
                <div key={review.id} className="rounded border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800">{review.industryName}</div>
                      {review.aiGeneratedAt && (
                        <div className="text-[10px] text-slate-400">
                          AI {new Date(review.aiGeneratedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {RATING_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const active = review.rating === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            title={option.label}
                            onClick={() => updateReview(review.id, { rating: option.value })}
                            className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${
                              active ? option.className : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            <Icon size={12} />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2 px-3 py-2">
                    <textarea
                      value={review.summary}
                      onChange={(event) => updateReview(review.id, { summary: event.target.value })}
                      className="min-h-16 w-full resize-y rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400 focus:bg-white"
                      placeholder="本周评价"
                    />
                    <textarea
                      value={review.demand}
                      onChange={(event) => updateReview(review.id, { demand: event.target.value })}
                      className="min-h-12 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                      placeholder="需求"
                    />
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <textarea
                        value={review.supplyDemandSignals.join('\n')}
                        onChange={(event) => updateReview(review.id, { supplyDemandSignals: normalizeArray(event.target.value) })}
                        className="min-h-20 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                        placeholder="供需信号"
                      />
                      <textarea
                        value={review.watchPoints.join('\n')}
                        onChange={(event) => updateReview(review.id, { watchPoints: normalizeArray(event.target.value) })}
                        className="min-h-20 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                        placeholder="未来关注"
                      />
                    </div>
                    <textarea
                      value={review.userNotes || ''}
                      onChange={(event) => updateReview(review.id, { userNotes: event.target.value })}
                      className="min-h-10 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400"
                      placeholder="我的补充"
                    />
                    {review.sourceTitles && review.sourceTitles.length > 0 && (
                      <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2">
                        {review.sourceTitles.slice(0, 4).map((title) => (
                          <span key={title} className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {title}
                          </span>
                        ))}
                        {review.sourceTitles.length > 4 && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">+{review.sourceTitles.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {reviews.length === 0 && (
                <div className="col-span-full flex h-56 items-center justify-center rounded border border-dashed border-slate-200 bg-white text-xs text-slate-400">
                  暂无行业
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-hidden rounded border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="text-xs font-semibold text-slate-700">未来关注提示</div>
            <div className="text-[10px] text-slate-400">{watchItems.length} 条</div>
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
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          item.rating === '+'
                            ? 'bg-emerald-50 text-emerald-700'
                            : item.rating === '-'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {item.rating}
                      </span>
                    </div>
                    <div className="text-xs leading-5 text-slate-700">{item.point}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
});
