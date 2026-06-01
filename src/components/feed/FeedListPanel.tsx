import { memo, useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { Loader2, Rss, Star, Trash2 } from 'lucide-react';
import type { FeedItem } from '../../db/apiClient.ts';
import { formatFeedTime } from '../../feed/feedItemModel.ts';
import { getFeedTypeConfig } from './feedTypeConfig.ts';

interface FeedListRowProps {
  item: FeedItem;
  selected: boolean;
  onSelect: (item: FeedItem) => void;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}

const FeedListRow = memo(function FeedListRow({ item, selected, onSelect, onToggleStar, onDelete }: FeedListRowProps) {
  const cfg = getFeedTypeConfig(item);
  const Icon = cfg.icon;

  const handleStar = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleStar(item.id);
  }, [item.id, onToggleStar]);

  const handleDelete = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete(item.id);
  }, [item.id, onDelete]);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`group w-full border-b border-slate-100 px-2.5 py-1.5 text-left transition-colors ${
        selected ? 'bg-blue-50' : item.isRead ? 'bg-white hover:bg-slate-50' : 'bg-white hover:bg-blue-50/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${cfg.bg} ${cfg.color}`} title={cfg.label}>
          <Icon size={12} />
        </div>
        {!item.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
        <div className="min-w-0 flex-1 truncate">
          <span className={`truncate text-[13px] font-medium leading-5 ${item.isRead ? 'text-slate-700' : 'text-slate-950'}`}>
            {item.title}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">{formatFeedTime(item.publishedAt)}</span>
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

interface FeedListPanelProps {
  items: FeedItem[];
  total: number;
  isLoading: boolean;
  selectedId: string | undefined;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onSelect: (item: FeedItem) => void;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
  onLoadMore: () => void;
  className?: string;
}

export const FeedListPanel = memo(function FeedListPanel({
  items,
  total,
  isLoading,
  selectedId,
  scrollRef,
  onScroll,
  onSelect,
  onToggleStar,
  onDelete,
  onLoadMore,
  className = '',
}: FeedListPanelProps) {
  return (
    <div className={`flex min-h-0 flex-col bg-white ${className}`}>
      <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Rss size={15} className="text-slate-500" />
          列表
        </div>
        <div className="shrink-0 text-[11px] text-slate-500">{items.length} / {total}</div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
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
            onSelect={onSelect}
            onToggleStar={onToggleStar}
            onDelete={onDelete}
          />
        ))}

        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={18} className="animate-spin text-slate-400" />
          </div>
        )}

        {!isLoading && items.length > 0 && items.length < total && (
          <button
            type="button"
            onClick={onLoadMore}
            className="w-full py-3 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            加载更多
          </button>
        )}
      </div>
    </div>
  );
});
