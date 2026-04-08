import { memo, useCallback } from 'react';
import { Star, Newspaper, BarChart3, Mic, FileText, TrendingUp } from 'lucide-react';
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
  onSelect: (item: FeedItem) => void;
}

export const FeedCard = memo(function FeedCard({ item, onSelect }: FeedCardProps) {
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const toggleRead = useFeedStore((s) => s.toggleRead);

  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  const Icon = cfg.icon;

  const handleClick = useCallback(() => {
    onSelect(item);
    if (!item.isRead) toggleRead(item.id);
  }, [item, onSelect, toggleRead]);

  // Preview: first 4 lines, max ~120 chars
  const preview = item.content.split('\n').filter(Boolean).slice(0, 4).join('\n').slice(0, 150);

  return (
    <div
      onClick={handleClick}
      className={`group relative rounded-lg border-l-[3px] border bg-white cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${cfg.border} ${
        item.isRead ? 'border-slate-100 opacity-75 hover:opacity-100' : 'border-slate-200 shadow-sm'
      }`}
    >
      {/* Unread dot */}
      {!item.isRead && (
        <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-blue-500" />
      )}

      <div className="p-3">
        {/* Type + Time row */}
        <div className="flex items-center justify-between mb-2">
          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
            <Icon size={10} />
            {cfg.label}
          </div>
          <span className="text-[10px] text-slate-400">{formatTime(item.publishedAt)}</span>
        </div>

        {/* Title */}
        <h3 className={`text-[13px] font-semibold leading-snug mb-1 line-clamp-2 ${item.isRead ? 'text-slate-500' : 'text-slate-800'}`}>
          {item.title}
        </h3>

        {/* Category tag */}
        {item.category && (
          <span className="inline-block text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded mb-1.5">
            {item.category}
          </span>
        )}

        {/* Content preview */}
        <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-3 whitespace-pre-wrap">
          {preview}
        </p>

        {/* Bottom: tags + star */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
          <div className="flex flex-wrap gap-1 min-w-0 overflow-hidden">
            {item.tags?.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-slate-50 text-slate-400 truncate max-w-[80px]">
                {tag}
              </span>
            ))}
            {item.source && !item.tags?.length && (
              <span className="text-[9px] text-slate-300 truncate">{item.source}</span>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); toggleStar(item.id); }}
            className={`shrink-0 p-1 rounded transition-colors ${
              item.isStarred ? 'text-amber-400' : 'text-slate-200 opacity-0 group-hover:opacity-100 hover:text-amber-400'
            }`}
          >
            <Star size={12} fill={item.isStarred ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </div>
  );
});
