import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Briefcase,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cpu,
  FileText,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Rss,
  Sparkles,
} from 'lucide-react';
import { overviewApi, type OverviewDailyResponse, type OverviewItem, type OverviewModuleKey } from '../../db/apiClient.ts';
import { useAICardStore, type AppViewMode } from '../../stores/aiCardStore.ts';

const TIMEZONE = 'Asia/Singapore';

const MODULE_META: Record<OverviewModuleKey, { label: string; icon: typeof Activity; tone: string }> = {
  canvas: { label: 'Canvas', icon: LayoutDashboard, tone: 'text-blue-700 bg-blue-50 border-blue-100' },
  ai_process: { label: 'AI Process', icon: Cpu, tone: 'text-violet-700 bg-violet-50 border-violet-100' },
  portfolio: { label: 'Portfolio', icon: Briefcase, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
  tracker: { label: '行业看板', icon: Activity, tone: 'text-amber-700 bg-amber-50 border-amber-100' },
  feed: { label: '信息流', icon: Rss, tone: 'text-cyan-700 bg-cyan-50 border-cyan-100' },
  ai_library: { label: '能力库', icon: Sparkles, tone: 'text-fuchsia-700 bg-fuchsia-50 border-fuchsia-100' },
};

const MODULE_VIEW_MODE: Record<OverviewModuleKey, AppViewMode> = {
  canvas: 'canvas',
  ai_process: 'ai_process',
  portfolio: 'portfolio',
  tracker: 'tracker',
  feed: 'feed',
  ai_library: 'ai_research',
};

const ACTION_LABELS: Record<string, string> = {
  created: '新增',
  updated: '更新',
  deleted: '删除',
  imported: '导入',
  generated: '生成',
  moved: '移动',
  ran: '运行',
};

const MODULE_KEYS = Object.keys(MODULE_META) as OverviewModuleKey[];

function dateInTimezone(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function todayInTimezone() {
  return dateInTimezone(new Date());
}

function addDays(date: string, days: number) {
  const base = new Date(`${date}T00:00:00+08:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return dateInTimezone(base);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIMEZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] || action;
}

const SummaryCard = memo(function SummaryCard({
  moduleKey,
  total,
  created,
  updated,
  deleted,
}: {
  moduleKey: OverviewModuleKey;
  total: number;
  created: number;
  updated: number;
  deleted: number;
}) {
  const meta = MODULE_META[moduleKey];
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${meta.tone}`}>
            <Icon size={15} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-slate-600">{meta.label}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              新增 {created} · 更新 {updated}{deleted ? ` · 删除 ${deleted}` : ''}
            </div>
          </div>
        </div>
        <div className="text-xl font-semibold text-slate-900">{total}</div>
      </div>
    </div>
  );
});

const EventRow = memo(function EventRow({ item, compact = false, onOpen }: { item: OverviewItem; compact?: boolean; onOpen?: (item: OverviewItem) => void }) {
  const meta = MODULE_META[item.module] || MODULE_META.canvas;
  const Icon = meta.icon;
  return (
    <div className="flex gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
      <div className="w-12 shrink-0 text-[11px] font-mono text-slate-400">{formatTime(item.occurredAt)}</div>
      <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border ${meta.tone}`}>
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {actionLabel(item.action)}
          </span>
          <span className="truncate text-sm font-semibold text-slate-800">{item.title || '(无标题)'}</span>
          <span className="text-[10px] text-slate-400">{item.source === 'event' ? '事件日志' : '时间戳回填'}</span>
        </div>
        <div className={compact ? 'mt-1 truncate text-xs text-slate-500' : 'mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500'}>
          <span className={compact ? '' : 'min-w-0 truncate'}>{[item.moduleLabel, item.entityType, item.location, item.summary].filter(Boolean).join(' · ')}</span>
          {!compact && onOpen && (
            <button
              onClick={() => onOpen(item)}
              className="shrink-0 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            >
              打开模块
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export const OverviewView = memo(function OverviewView() {
  const setViewMode = useAICardStore((s) => s.setViewMode);
  const [date, setDate] = useState(todayInTimezone());
  const [data, setData] = useState<OverviewDailyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await overviewApi.getDaily({ date, timezone: TIMEZONE });
      setData(result);
    } catch (err: any) {
      setError(err?.message || '加载纵览失败');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const activeModules = useMemo(
    () => MODULE_KEYS.filter((key) => (data?.modules?.[key]?.length || 0) > 0),
    [data],
  );
  const timeline = data?.timeline || [];
  const openItem = useCallback((item: OverviewItem) => {
    setViewMode(MODULE_VIEW_MODE[item.module] || 'canvas');
  }, [setViewMode]);

  return (
    <div className="mobile-scroll-container h-full overflow-y-auto bg-slate-50">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Activity size={18} className="text-blue-600" />
                Research Canvas 每日纵览
              </div>
              <div className="mt-1 text-xs text-slate-500">
                对象级变化 · 时区 {TIMEZONE} · 旧数据来自时间戳回填
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDate((current) => addDays(current, -1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                title="前一天"
              >
                <ChevronLeft size={16} />
              </button>
              <label className="relative">
                <CalendarDays size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value || todayInTimezone())}
                  className="h-9 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400"
                />
              </label>
              <button
                onClick={() => setDate((current) => addDays(current, 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                title="后一天"
              >
                <ChevronRight size={16} />
              </button>
              <button
                onClick={load}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                Refresh
              </button>
            </div>
          </div>
          {data?.loadedAt && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Clock3 size={12} />
              最后加载 {formatDateTime(data.loadedAt)}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {data?.warnings?.length ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {data.warnings.join('；')}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {MODULE_KEYS.map((key) => {
            const total = data?.totals?.[key] || { created: 0, updated: 0, deleted: 0, total: 0 };
            return (
              <SummaryCard
                key={key}
                moduleKey={key}
                created={total.created}
                updated={total.updated}
                deleted={total.deleted}
                total={total.total}
              />
            );
          })}
        </div>

        {loading && !data ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-400">
            <Loader2 size={18} className="mr-2 animate-spin" />
            正在加载纵览...
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-400">
            <FileText size={30} className="mb-2 text-slate-300" />
            当天无记录
            {data?.loadedAt && <span className="mt-1 text-[11px]">最后加载 {formatDateTime(data.loadedAt)}</span>}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),420px]">
            <div className="space-y-4">
              {activeModules.map((key) => {
                const meta = MODULE_META[key];
                const Icon = meta.icon;
                const items = data?.modules?.[key] || [];
                return (
                  <section key={key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <Icon size={14} className="text-slate-500" />
                        {meta.label}
                      </div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{items.length}</span>
                    </div>
                    <div>
                      {items.map((item) => (
                        <EventRow key={item.id} item={item} onOpen={openItem} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                全站时间线
              </div>
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                {timeline.map((item) => (
                  <EventRow key={item.id} item={item} compact />
                ))}
              </div>
            </aside>
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Sparkles size={14} className="text-blue-600" />
              Research Canvas 功能图
            </div>
            <div className="text-[11px] text-slate-400">
              Canvas 功能模块 · 本地 Codex 写回行业看板
            </div>
          </div>
          <div className="overflow-x-auto bg-white p-3">
            <img
              src="/research-canvas-system-map.svg"
              alt="Research Canvas 功能与本地 Codex 写回链路"
              className="block w-full min-w-[980px] rounded-md border border-slate-100"
            />
          </div>
        </section>
      </div>
    </div>
  );
});
