import { memo, useCallback } from 'react';
import { X, Star, Trash2, ExternalLink, Clock, Tag, Newspaper, BarChart3, Mic, FileText, TrendingUp } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { formatTime } from './FeedCard.tsx';
import type { FeedItem } from '../../db/apiClient.ts';

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Newspaper }> = {
  news:     { label: '财经快讯', color: 'text-red-600',    bg: 'bg-red-50',    icon: Newspaper },
  industry: { label: '行业报告', color: 'text-blue-600',   bg: 'bg-blue-50',   icon: BarChart3 },
  podcast:  { label: '播客',     color: 'text-purple-600', bg: 'bg-purple-50', icon: Mic },
  weekly:   { label: '周报',     color: 'text-emerald-600',  bg: 'bg-emerald-50',  icon: FileText },
  macro:    { label: '宏观数据', color: 'text-amber-600',  bg: 'bg-amber-50',  icon: TrendingUp },
};

interface FeedDetailProps {
  item: FeedItem;
  onClose: () => void;
}

export const FeedDetail = memo(function FeedDetail({ item, onClose }: FeedDetailProps) {
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const removeFeedItem = useFeedStore((s) => s.removeFeedItem);

  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  const Icon = cfg.icon;

  const handleDelete = useCallback(() => {
    if (confirm('确定删除这条信息？')) {
      removeFeedItem(item.id);
      onClose();
    }
  }, [item.id, removeFeedItem, onClose]);

  return (
    <div className="w-[420px] shrink-0 border-l border-slate-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${cfg.bg} ${cfg.color}`}>
          <Icon size={13} />
          {cfg.label}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleStar(item.id)}
            className={`p-1.5 rounded-md transition-colors ${
              item.isStarred ? 'text-amber-400 hover:text-amber-500' : 'text-slate-300 hover:text-amber-400'
            }`}
            title={item.isStarred ? '取消收藏' : '收藏'}
          >
            <Star size={15} fill={item.isStarred ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md text-slate-300 hover:text-red-500 transition-colors"
            title="删除"
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-300 hover:text-slate-600 transition-colors"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Title */}
        <h2 className="text-base font-semibold text-slate-800 leading-snug mb-3">
          {item.title}
        </h2>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mb-4">
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {formatTime(item.publishedAt)}
          </span>
          {item.source && (
            <span className="flex items-center gap-1">
              <ExternalLink size={11} />
              {item.source}
            </span>
          )}
          {item.category && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
              {item.category}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {item.content}
        </div>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
              <Tag size={11} />
              标签
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
