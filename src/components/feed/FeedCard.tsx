import { memo, useState, useCallback } from 'react';
import { Star, Trash2, ChevronDown, ChevronUp, Newspaper, BarChart3, Mic, FileText, TrendingUp } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import type { FeedItem } from '../../db/apiClient.ts';

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Newspaper }> = {
  news:     { label: '财经快讯', color: 'text-red-600',    bg: 'bg-red-50',    icon: Newspaper },
  industry: { label: '行业',     color: 'text-blue-600',   bg: 'bg-blue-50',   icon: BarChart3 },
  podcast:  { label: '播客',     color: 'text-purple-600', bg: 'bg-purple-50', icon: Mic },
  weekly:   { label: '周报',     color: 'text-green-600',  bg: 'bg-green-50',  icon: FileText },
  macro:    { label: '宏观',     color: 'text-amber-600',  bg: 'bg-amber-50',  icon: TrendingUp },
};

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3600000;

  if (diffH < 1) return `${Math.floor(diffMs / 60000)}分钟前`;
  if (diffH < 24) return `${Math.floor(diffH)}小时前`;
  if (diffH < 48) return '昨天';

  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const FeedCard = memo(function FeedCard({ item }: { item: FeedItem }) {
  const toggleRead = useFeedStore((s) => s.toggleRead);
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const removeFeedItem = useFeedStore((s) => s.removeFeedItem);

  const [expanded, setExpanded] = useState(false);

  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  const Icon = cfg.icon;

  const handleClick = useCallback(() => {
    setExpanded((prev) => !prev);
    if (!item.isRead) {
      toggleRead(item.id);
    }
  }, [item.id, item.isRead, toggleRead]);

  // Truncate content for preview
  const previewLines = item.content.split('\n').slice(0, 3).join('\n');
  const hasMore = item.content.length > previewLines.length + 10;

  return (
    <div
      className={`group rounded-lg border transition-all ${
        item.isRead
          ? 'border-slate-100 bg-white'
          : 'border-slate-200 bg-white shadow-sm'
      }`}
    >
      {/* Header row */}
      <div
        onClick={handleClick}
        className="flex items-start gap-3 px-4 py-3 cursor-pointer select-none"
      >
        {/* Unread dot */}
        <div className="mt-1.5 shrink-0 w-2 h-2">
          {!item.isRead && <div className="w-2 h-2 rounded-full bg-blue-500" />}
        </div>

        {/* Type badge */}
        <div className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
          <Icon size={11} />
          {cfg.label}
        </div>

        {/* Title & meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`text-sm font-medium truncate ${item.isRead ? 'text-slate-500' : 'text-slate-800'}`}>
              {item.title}
            </h3>
            {item.category && (
              <span className="shrink-0 text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                {item.category}
              </span>
            )}
          </div>
          {!expanded && (
            <p className="text-xs text-slate-400 mt-1 line-clamp-2 whitespace-pre-wrap">
              {previewLines}
            </p>
          )}
        </div>

        {/* Time */}
        <span className="shrink-0 text-[11px] text-slate-400 mt-0.5">
          {formatTime(item.publishedAt)}
        </span>

        {/* Expand chevron */}
        <div className="shrink-0 mt-0.5 text-slate-300">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-slate-50">
          <div className="pt-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto">
            {item.content}
          </div>

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {item.tags.map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-50">
            <button
              onClick={(e) => { e.stopPropagation(); toggleStar(item.id); }}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                item.isStarred ? 'text-amber-500 bg-amber-50' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'
              }`}
            >
              <Star size={12} fill={item.isStarred ? 'currentColor' : 'none'} />
              {item.isStarred ? '已收藏' : '收藏'}
            </button>

            {item.source && (
              <span className="text-[10px] text-slate-400 ml-auto">
                来源: {item.source}
              </span>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); removeFeedItem(item.id); }}
              className="text-slate-300 hover:text-red-400 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
