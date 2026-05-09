import { memo } from 'react';
import { Newspaper, BarChart3, Mic, FileText, TrendingUp, Layers, FileCode2 } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { SectionLabel } from '../ui/index.ts';
import { SUMMARY_REPORT_LABEL } from '../../utils/feedLabels.ts';

const TYPE_OPTIONS = [
  { value: '', label: '全部', icon: Layers },
  { value: 'news', label: '财经快讯', icon: Newspaper },
  { value: 'industry', label: '行业报告', icon: BarChart3 },
  { value: 'podcast', label: '播客', icon: Mic },
  { value: 'weekly', label: SUMMARY_REPORT_LABEL, icon: FileText },
  { value: 'macro', label: '宏观数据', icon: TrendingUp },
  { value: 'report', label: '交互报告', icon: FileCode2 },
];

export const FeedFilters = memo(function FeedFilters() {
  const filters = useFeedStore((s) => s.filters);
  const typeStats = useFeedStore((s) => s.typeStats);
  const categoryStats = useFeedStore((s) => s.categoryStats);
  const reportTypeStats = useFeedStore((s) => s.reportTypeStats);
  const setFilter = useFeedStore((s) => s.setFilter);
  const clearFilters = useFeedStore((s) => s.clearFilters);

  const activeType = filters.type || '';
  const totalUnread = typeStats.reduce((sum, stat) => sum + stat.unread, 0);
  const unreadForType = (value: string) => value ? typeStats.find((stat) => stat.value === value)?.unread || 0 : totalUnread;
  const unreadForReportType = (value?: string) => {
    if (!value) return reportTypeStats.reduce((sum, stat) => sum + stat.unread, 0);
    return reportTypeStats.find((stat) => stat.value === value)?.unread || 0;
  };
  const unreadForCategory = (value?: string) => {
    if (!value) return categoryStats.reduce((sum, stat) => sum + stat.unread, 0);
    return categoryStats.find((stat) => stat.value === value)?.unread || 0;
  };

  const RedDot = ({ count }: { count: number }) => (
    count > 0 ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title={`${count} 条未读`} /> : null
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50 p-2">
      {/* Type filter */}
      <div className="shrink-0">
        <SectionLabel className="px-1">类型</SectionLabel>
        <div className="space-y-0.5">
          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setFilter({ type: value || undefined, reportType: value === 'report' ? filters.reportType : undefined })}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                activeType === value
                  ? 'bg-blue-100 text-blue-800 font-medium'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
              title={label}
            >
              <Icon size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              <RedDot count={unreadForType(value)} />
            </button>
          ))}
        </div>
      </div>

      {/* Report subtype filter */}
      {(activeType === 'report' || filters.reportType) && reportTypeStats.length > 0 && (
        <div className="mt-2 shrink-0">
          <SectionLabel className="px-1">报告类型</SectionLabel>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            <button
              onClick={() => setFilter({ reportType: undefined })}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                !filters.reportType ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-left">全部报告</span>
              <RedDot count={unreadForReportType()} />
            </button>
            {reportTypeStats.map((reportType) => (
              <button
                key={reportType.value}
                onClick={() => setFilter({ type: 'report', reportType: filters.reportType === reportType.value ? undefined : reportType.value })}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                  filters.reportType === reportType.value ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
                }`}
                title={reportType.label}
              >
                <span className="min-w-0 flex-1 truncate text-left">{reportType.label}</span>
                <RedDot count={reportType.unread} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category filter */}
      {categoryStats.length > 0 && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <SectionLabel className="px-1">行业</SectionLabel>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
            <button
              onClick={() => setFilter({ category: undefined })}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                !filters.category ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-left">全部行业</span>
              <RedDot count={unreadForCategory()} />
            </button>
            {categoryStats.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setFilter({ category: filters.category === cat.value ? undefined : cat.value })}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                  filters.category === cat.value ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'
                }`}
                title={cat.label}
              >
                <span className="min-w-0 flex-1 truncate text-left">{cat.label}</span>
                <RedDot count={cat.unread} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Clear all filters */}
      {Object.values(filters).some(Boolean) && (
        <button
          onClick={clearFilters}
          className="mt-2 w-full shrink-0 py-1 text-xs text-slate-400 transition-colors hover:text-slate-600"
        >
          清除所有筛选
        </button>
      )}
    </div>
  );
});
