import { memo, useEffect, useCallback, useRef } from 'react';
import { Loader2, CheckCheck } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { FeedFilters } from './FeedFilters.tsx';
import { FeedCard } from './FeedCard.tsx';
import { ResponsiveLayout } from '../layout/ResponsiveLayout.tsx';

export const FeedView = memo(function FeedView() {
  const items = useFeedStore((s) => s.items);
  const total = useFeedStore((s) => s.total);
  const isLoading = useFeedStore((s) => s.isLoading);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const loadMore = useFeedStore((s) => s.loadMore);
  const markAllRead = useFeedStore((s) => s.markAllRead);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      loadMore();
    }
  }, [loadMore]);

  const unreadCount = items.filter((i) => !i.isRead).length;

  return (
    <ResponsiveLayout sidebar={<FeedFilters />} sidebarWidth={200} drawerTitle="信息流筛选">
      {/* Center: Card grid */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-slate-800">信息流</h1>
            <span className="text-xs text-slate-500">
              {total} 条{unreadCount > 0 && <span className="text-orange-500 ml-1">({unreadCount} 未读)</span>}
            </span>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
            >
              <CheckCheck size={13} />
              全部已读
            </button>
          )}
        </div>

        {/* Grid area */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4"
        >
          {items.length === 0 && !isLoading && (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
              暂无信息
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
            {items.map((item) => (
              <FeedCard key={item.id} item={item} />
            ))}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          )}

          {!isLoading && items.length > 0 && items.length < total && (
            <button onClick={loadMore} className="w-full py-3 text-xs text-slate-500 hover:text-slate-700 transition-colors">
              加载更多...
            </button>
          )}
        </div>
      </div>
    </ResponsiveLayout>
  );
});
