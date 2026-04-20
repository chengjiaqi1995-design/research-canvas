import { memo, useCallback, useState } from 'react';
import { Star, Trash2, ChevronDown, ChevronUp, Newspaper, BarChart3, Mic, FileText, TrendingUp } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import type { FeedItem } from '../../db/apiClient.ts';

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: typeof Newspaper }> = {
  news:     { label: '财经快讯', color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-l-red-400',    icon: Newspaper },
  industry: { label: '行业',     color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-l-blue-400',   icon: BarChart3 },
  podcast:  { label: '播客',     color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-l-purple-400', icon: Mic },
  weekly:   { label: '周报',     color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-l-green-400',  icon: FileText },
  macro:    { label: '宏观',     color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-l-amber-400',  icon: TrendingUp },
};

export function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}分钟前`;
  if (diffH < 24) return `${Math.floor(diffH)}小时前`;
  if (diffH < 48) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface FeedCardProps {
  item: FeedItem;
}

export const FeedCard = memo(function FeedCard({ item }: FeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const toggleRead = useFeedStore((s) => s.toggleRead);
  const removeFeedItem = useFeedStore((s) => s.removeFeedItem);

  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  const Icon = cfg.icon;

  const handleClick = useCallback(() => {
    setExpanded((prev) => !prev);
    if (!item.isRead) toggleRead(item.id);
  }, [item, toggleRead]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeFeedItem(item.id);
  }, [item.id, removeFeedItem]);

  // Preview: first few lines
  const preview = item.content.split('\n').filter(Boolean).slice(0, 3).join('\n').slice(0, 120);

  return (
    <div
      onClick={handleClick}
      className={`group relative rounded-md border-l-[3px] border bg-white cursor-pointer transition-all hover:shadow-md ${cfg.border} ${
        item.isRead ? 'border-slate-100' : 'border-slate-200 shadow-sm'
      } ${expanded ? 'col-span-1 row-span-auto' : 'hover:-translate-y-0.5'}`}
    >
      {/* Unread dot */}
      {!item.isRead && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500" />
      )}

      <div className="p-2.5">
        {/* Type + Time row */}
        <div className="flex items-center justify-between mb-1.5">
          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
            <Icon size={10} />
            {cfg.label}
          </div>
          <span className="text-[10px] text-slate-500">{formatTime(item.publishedAt)}</span>
        </div>

        {/* Title */}
        <h3 className={`text-xs font-semibold leading-snug mb-1 ${expanded ? '' : 'line-clamp-2'} ${item.isRead ? 'text-slate-600' : 'text-slate-800'}`}>
          {item.title}
        </h3>

        {/* Category tag */}
        {item.category && (
          <span className="inline-block text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mb-1">
            {item.category}
          </span>
        )}

        {/* Content: preview or full */}
        {expanded ? (
          <div className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap mt-1">
            {item.content}
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2 whitespace-pre-wrap">
            {preview}
          </p>
        )}

        {/* Tags (shown when expanded) */}
        {expanded && item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {item.tags.map((tag) => (
              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Bottom: tags/source + actions */}
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {!expanded && item.tags?.slice(0, 2).map((tag) => (
              <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-slate-100 text-slate-600 truncate max-w-[70px]">
                {tag}
              </span>
            ))}
            {item.source && (expanded || !item.tags?.length) && (
              <span className="text-[9px] text-slate-500 truncate">{item.source}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Expand/collapse indicator */}
            <span className="p-1 text-slate-400">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); toggleStar(item.id); }}
              className={`p-1 rounded transition-colors ${
                item.isStarred ? 'text-amber-400' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-400'
              }`}
            >
              <Star size={12} fill={item.isStarred ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={handleDelete}
              className="p-1 rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
