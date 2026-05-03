import { memo } from 'react';
import { Newspaper, BarChart3, Mic, FileText, TrendingUp, Layers, FileCode2 } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { SectionLabel } from '../ui/index.ts';

const TYPE_OPTIONS = [
  { value: '', label: '全部', icon: Layers },
  { value: 'news', label: '财经快讯', icon: Newspaper },
  { value: 'industry', label: '行业报告', icon: BarChart3 },
  { value: 'podcast', label: '播客', icon: Mic },
  { value: 'weekly', label: '周报', icon: FileText },
  { value: 'macro', label: '宏观数据', icon: TrendingUp },
  { value: 'report', label: '交互报告', icon: FileCode2 },
];

export const FeedFilters = memo(function FeedFilters() {
  const filters = useFeedStore((s) => s.filters);
  const categories = useFeedStore((s) => s.categories);
  const reportTypes = useFeedStore((s) => s.reportTypes);
  const setFilter = useFeedStore((s) => s.setFilter);
  const clearFilters = useFeedStore((s) => s.clearFilters);

  const activeType = filters.type || '';

  return (
    <div className="flex flex-col h-full bg-slate-50 w-full p-2 space-y-2">
      {/* Type filter */}
      <div>
        <SectionLabel className="px-1">类型</SectionLabel>
        <div className="space-y-0.5">
          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setFilter({ type: value || undefined, reportType: value === 'report' ? filters.reportType : undefined })}
              className={`flex items-center gap-2 w-full px-2 py-1 text-xs rounded transition-colors ${
                activeType === value
                  ? 'bg-blue-100 text-blue-800 font-medium'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Report subtype filter */}
      {(activeType === 'report' || filters.reportType) && reportTypes.length > 0 && (
        <div>
          <SectionLabel className="px-1">报告类型</SectionLabel>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            <button
              onClick={() => setFilter({ reportType: undefined })}
              className={`flex items-center w-full px-2 py-1 text-xs rounded transition-colors ${
                !filters.reportType ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              全部报告
            </button>
            {reportTypes.map((reportType) => (
              <button
                key={reportType.value}
                onClick={() => setFilter({ type: 'report', reportType: filters.reportType === reportType.value ? undefined : reportType.value })}
                className={`flex items-center w-full px-2 py-1 text-xs rounded transition-colors truncate ${
                  filters.reportType === reportType.value ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
                }`}
                title={reportType.label}
              >
                {reportType.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category filter */}
      {categories.length > 0 && (
        <div>
          <SectionLabel className="px-1">行业</SectionLabel>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            <button
              onClick={() => setFilter({ category: undefined })}
              className={`flex items-center w-full px-2 py-1 text-xs rounded transition-colors ${
                !filters.category ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              全部行业
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter({ category: filters.category === cat ? undefined : cat })}
                className={`flex items-center w-full px-2 py-1 text-xs rounded transition-colors truncate ${
                  filters.category === cat ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
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
