import { memo } from 'react';
import { Newspaper, BarChart3, Mic, FileText, TrendingUp, Layers, Star, Eye, EyeOff } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';

const TYPE_OPTIONS = [
  { value: '', label: '全部', icon: Layers },
  { value: 'news', label: '财经快讯', icon: Newspaper },
  { value: 'industry', label: '行业报告', icon: BarChart3 },
  { value: 'podcast', label: '播客', icon: Mic },
  { value: 'weekly', label: '周报', icon: FileText },
  { value: 'macro', label: '宏观数据', icon: TrendingUp },
];

export const FeedFilters = memo(function FeedFilters() {
  const filters = useFeedStore((s) => s.filters);
  const categories = useFeedStore((s) => s.categories);
  const setFilter = useFeedStore((s) => s.setFilter);
  const clearFilters = useFeedStore((s) => s.clearFilters);

  const activeType = filters.type || '';

  return (
    <div className="p-3 space-y-5">
      {/* Type filter */}
      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">类型</div>
        <div className="space-y-0.5">
          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setFilter({ type: value || undefined })}
              className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                activeType === value
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Read/Starred shortcuts */}
      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">状态</div>
        <div className="space-y-0.5">
          <button
            onClick={() => {
              const current = filters.isRead;
              setFilter({ isRead: current === 'false' ? undefined : 'false' });
            }}
            className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md transition-colors ${
              filters.isRead === 'false' ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <EyeOff size={13} />
            仅未读
          </button>
          <button
            onClick={() => {
              const current = filters.isRead;
              setFilter({ isRead: current === 'true' ? undefined : 'true' });
            }}
            className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md transition-colors ${
              filters.isRead === 'true' ? 'bg-slate-100 text-slate-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Eye size={13} />
            仅已读
          </button>
          <button
            onClick={() => {
              const current = filters.isStarred;
              setFilter({ isStarred: current === 'true' ? undefined : 'true' });
            }}
            className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md transition-colors ${
              filters.isStarred === 'true' ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Star size={13} />
            已收藏
          </button>
        </div>
      </div>

      {/* Category filter */}
      {categories.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">行业</div>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            <button
              onClick={() => setFilter({ category: undefined })}
              className={`flex items-center w-full px-2.5 py-1.5 text-xs rounded-md transition-colors ${
                !filters.category ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              全部行业
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter({ category: filters.category === cat ? undefined : cat })}
                className={`flex items-center w-full px-2.5 py-1.5 text-xs rounded-md transition-colors truncate ${
                  filters.category === cat ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clear all filters */}
      {Object.values(filters).some(Boolean) && (
        <button
          onClick={clearFilters}
          className="w-full text-xs text-slate-400 hover:text-slate-600 py-1 transition-colors"
        >
          清除所有筛选
        </button>
      )}
    </div>
  );
});
