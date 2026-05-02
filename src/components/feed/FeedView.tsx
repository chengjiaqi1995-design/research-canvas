import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  BarChart3,
  CheckCheck,
  Clock,
  ExternalLink,
  FileCode2,
  FileText,
  Loader2,
  Mic,
  Newspaper,
  Rss,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { FeedFilters } from './FeedFilters.tsx';
import { formatTime } from './FeedCard.tsx';
import { ResponsiveLayout } from '../layout/ResponsiveLayout.tsx';
import { PageHeader } from '../ui/index.ts';
import { parseAIMarkdown } from '../../utils/markdownParser.ts';
import type { FeedItem } from '../../db/apiClient.ts';
import * as portfolioApi from '../../aiprocess/api/portfolio.ts';
import type { PortfolioFeedImpact, PortfolioImpactDirection } from '../../aiprocess/types/portfolio.ts';

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Newspaper }> = {
  news: { label: '财经快讯', color: 'text-red-700', bg: 'bg-red-50', icon: Newspaper },
  industry: { label: '行业报告', color: 'text-blue-700', bg: 'bg-blue-50', icon: BarChart3 },
  podcast: { label: '播客', color: 'text-violet-700', bg: 'bg-violet-50', icon: Mic },
  weekly: { label: '周报', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: FileText },
  macro: { label: '宏观数据', color: 'text-amber-700', bg: 'bg-amber-50', icon: TrendingUp },
  report: { label: '交互报告', color: 'text-cyan-700', bg: 'bg-cyan-50', icon: FileCode2 },
};

function isHtmlReport(item: FeedItem) {
  return item.type === 'report' || item.contentFormat === 'html' || Boolean(item.htmlUrl);
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getReportLabel(item: FeedItem) {
  if (!isHtmlReport(item)) return undefined;
  return item.reportTypeLabel || item.category || '交互报告';
}

function getPreview(item: FeedItem) {
  if (isHtmlReport(item)) {
    return [item.originalName || item.reportKey, item.source, item.reportVersion].filter(Boolean).join(' · ') || getReportLabel(item) || '交互报告';
  }
  const content = item.contentFormat === 'html' ? stripHtml(item.content) : item.content;
  return content.split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 140);
}

function getTypeConfig(item: FeedItem) {
  const base = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  if (isHtmlReport(item)) {
    return { ...base, label: getReportLabel(item) || base.label };
  }
  return base;
}

const IMPACT_DIRECTION_LABELS: Record<PortfolioImpactDirection, string> = {
  positive: '正面',
  negative: '负面',
  neutral: '中性',
  mixed: '混合',
};

function impactDirectionClass(direction: PortfolioImpactDirection) {
  if (direction === 'positive') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (direction === 'negative') return 'bg-red-50 text-red-700 border-red-100';
  if (direction === 'mixed') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function FeedImpactStrip({ impacts, loading }: { impacts: PortfolioFeedImpact[]; loading: boolean }) {
  const openAlertCount = impacts.reduce((count, impact) => count + (impact.alerts || []).filter((alert) => alert.status === 'open').length, 0);
  if (!loading && impacts.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-4 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <ShieldAlert size={13} className={openAlertCount ? 'text-red-600' : 'text-slate-400'} />
          Portfolio Impact
        </div>
        <div className="text-[11px] text-slate-400">
          {loading ? '加载中...' : `${impacts.length} impacts · ${openAlertCount} alerts`}
        </div>
      </div>
      {!loading && (
        <div className="flex flex-wrap gap-1.5">
          {impacts.slice(0, 5).map((impact) => {
            const hasAlert = (impact.alerts || []).some((alert) => alert.status === 'open');
            return (
              <span key={impact.id} className={`inline-flex max-w-[260px] items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${hasAlert ? 'border-red-200 bg-red-50 text-red-700' : impactDirectionClass(impact.portfolioDirection)}`}>
                <span className="truncate">{impact.position.nameCn || impact.position.nameEn || impact.position.tickerBbg}</span>
                <span className="shrink-0">{IMPACT_DIRECTION_LABELS[impact.portfolioDirection]}</span>
              </span>
            );
          })}
          {impacts.length > 5 && <span className="text-[11px] text-slate-400">+{impacts.length - 5}</span>}
        </div>
      )}
    </div>
  );
}

interface FeedListRowProps {
  item: FeedItem;
  selected: boolean;
  onSelect: (item: FeedItem) => void;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}

const FeedListRow = memo(function FeedListRow({ item, selected, onSelect, onToggleStar, onDelete }: FeedListRowProps) {
  const cfg = getTypeConfig(item);
  const Icon = cfg.icon;

  const handleStar = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleStar(item.id);
  }, [item.id, onToggleStar]);

  const handleDelete = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete(item.id);
  }, [item.id, onDelete]);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`group w-full text-left px-2.5 py-1.5 border-b border-slate-100 transition-colors ${
        selected ? 'bg-blue-50' : item.isRead ? 'bg-white hover:bg-slate-50' : 'bg-white hover:bg-blue-50/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${cfg.bg} ${cfg.color}`} title={cfg.label}>
          <Icon size={12} />
        </div>
        {!item.isRead && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
        <div className="min-w-0 flex-1 truncate">
          <span className={`truncate text-[13px] font-medium leading-5 ${item.isRead ? 'text-slate-700' : 'text-slate-950'}`}>
            {item.title}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">{formatTime(item.publishedAt)}</span>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleStar}
            className={`rounded p-1 ${item.isStarred ? 'text-amber-500 opacity-100' : 'text-slate-300 hover:text-amber-500'}`}
            title={item.isStarred ? '取消收藏' : '收藏'}
          >
            <Star size={13} fill={item.isStarred ? 'currentColor' : 'none'} />
          </button>
          <button type="button" onClick={handleDelete} className="rounded p-1 text-slate-300 hover:text-red-500" title="删除">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </button>
  );
});

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-400">
      选择一条信息查看内容
    </div>
  );
}

interface FeedDetailPaneProps {
  item: FeedItem | undefined;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}

const FeedDetailPane = memo(function FeedDetailPane({ item, onToggleStar, onDelete }: FeedDetailPaneProps) {
  const itemId = item?.id;
  const [portfolioImpacts, setPortfolioImpacts] = useState<PortfolioFeedImpact[]>([]);
  const [portfolioImpactLoading, setPortfolioImpactLoading] = useState(false);

  useEffect(() => {
    if (!itemId) {
      setPortfolioImpacts([]);
      setPortfolioImpactLoading(false);
      return;
    }
    let cancelled = false;
    setPortfolioImpactLoading(true);
    portfolioApi.getPortfolioImpacts({ feedItemId: itemId, days: 365, limit: 50 })
      .then((res) => { if (!cancelled) setPortfolioImpacts(res.data.data.impacts || []); })
      .catch(() => { if (!cancelled) setPortfolioImpacts([]); })
      .finally(() => { if (!cancelled) setPortfolioImpactLoading(false); });
    return () => { cancelled = true; };
  }, [itemId]);

  if (!item) return <EmptyDetail />;

  const cfg = getTypeConfig(item);
  const Icon = cfg.icon;
  const html = isHtmlReport(item);
  const body = item.contentFormat === 'html' && !html ? stripHtml(item.content) : item.content;
  const renderedMarkdown = item.contentFormat === 'text' ? '' : parseAIMarkdown(body);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cfg.bg} ${cfg.color}`}>
                <Icon size={12} />
                {cfg.label}
              </span>
              {item.category && <span className="text-[11px] text-slate-500">{item.category}</span>}
              {item.source && <span className="text-[11px] text-slate-400">{item.source}</span>}
            </div>
            <h2 className="truncate text-[17px] font-semibold leading-6 text-slate-950">{item.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {formatTime(item.publishedAt)}
              </span>
              {item.originalName && <span className="truncate">{item.originalName}</span>}
              {item.reportTypeLabel && <span className="truncate">{item.reportTypeLabel}</span>}
              {item.reportVersion && <span className="truncate">{item.reportVersion}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {html && item.htmlUrl && (
              <a
                href={item.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                <ExternalLink size={13} />
                新标签
              </a>
            )}
            <button
              type="button"
              onClick={() => onToggleStar(item.id)}
              className={`rounded p-1.5 ${item.isStarred ? 'text-amber-500' : 'text-slate-400 hover:bg-slate-100 hover:text-amber-500'}`}
              title={item.isStarred ? '取消收藏' : '收藏'}
            >
              <Star size={15} fill={item.isStarred ? 'currentColor' : 'none'} />
            </button>
            <button type="button" onClick={() => onDelete(item.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="删除">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>

      <FeedImpactStrip impacts={portfolioImpacts} loading={portfolioImpactLoading} />

      {html ? (
        <iframe
          key={`${item.id}:${item.reportVersion || item.updatedAt}`}
          title={item.title}
          src={item.htmlUrl || undefined}
          srcDoc={item.htmlUrl ? undefined : item.content}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
          className="h-0 min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <div
          className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 outline-none"
          tabIndex={0}
          aria-label="信息流正文"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {item.contentFormat === 'text' ? (
            <article className="max-w-4xl whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">
              {body}
            </article>
          ) : (
            <article
              className="prose prose-sm max-w-4xl break-words text-slate-800 leading-relaxed prose-headings:text-slate-950 prose-headings:font-bold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-a:text-blue-600 prose-strong:text-slate-950 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
            />
          )}
          {item.tags && item.tags.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
                <Tag size={12} />
                标签
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
});

export const FeedView = memo(function FeedView() {
  const items = useFeedStore((s) => s.items);
  const total = useFeedStore((s) => s.total);
  const isLoading = useFeedStore((s) => s.isLoading);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const loadMore = useFeedStore((s) => s.loadMore);
  const markAllRead = useFeedStore((s) => s.markAllRead);
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const toggleRead = useFeedStore((s) => s.toggleRead);
  const removeFeedItem = useFeedStore((s) => s.removeFeedItem);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => { loadFeed(); }, [loadFeed]);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      loadMore();
    }
  }, [loadMore]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId), [items, selectedId]);
  const unreadCount = items.filter((i) => !i.isRead).length;

  const handleSelect = useCallback((item: FeedItem) => {
    setSelectedId(item.id);
    if (!item.isRead) void toggleRead(item.id);
  }, [toggleRead]);

  const handleDelete = useCallback((id: string) => {
    if (confirm('确定删除这条信息？')) {
      void removeFeedItem(id);
    }
  }, [removeFeedItem]);

  const handleToggleStar = useCallback((id: string) => {
    void toggleStar(id);
  }, [toggleStar]);

  return (
    <ResponsiveLayout sidebar={<FeedFilters />} sidebarWidth={200} drawerTitle="信息流筛选">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader
          title="信息流"
          subtitle={
            <>
              {total} 条
              {unreadCount > 0 && <span className="ml-1 text-blue-500">· {unreadCount} 未读</span>}
            </>
          }
          right={
            unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <CheckCheck size={12} />
                全部已读
              </button>
            )
          }
        />

        <div className="h-0 min-h-0 flex-1 overflow-hidden bg-slate-100/70 p-2">
          <div className="flex h-full min-w-0 overflow-hidden rounded border border-slate-200 bg-white">
            <aside className="flex w-[390px] shrink-0 flex-col border-r border-slate-200 bg-white max-[1050px]:w-[330px]">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 px-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Rss size={15} className="text-slate-500" />
                  列表
                </div>
                <div className="text-[11px] text-slate-500">{items.length} / {total}</div>
              </div>

              <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
                {items.length === 0 && !isLoading && (
                  <div className="flex h-48 items-center justify-center text-sm text-slate-400">
                    暂无信息
                  </div>
                )}

                {items.map((item) => (
                  <FeedListRow
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onSelect={handleSelect}
                    onToggleStar={handleToggleStar}
                    onDelete={handleDelete}
                  />
                ))}

                {isLoading && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={18} className="animate-spin text-slate-400" />
                  </div>
                )}

                {!isLoading && items.length > 0 && items.length < total && (
                  <button onClick={loadMore} className="w-full py-3 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700">
                    加载更多
                  </button>
                )}
              </div>
            </aside>

            <FeedDetailPane item={selectedItem} onToggleStar={handleToggleStar} onDelete={handleDelete} />
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  );
});
