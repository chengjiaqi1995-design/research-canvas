import { memo, useCallback, useState } from 'react';
import { Star, Trash2, ChevronDown, ChevronUp, Newspaper, BarChart3, Mic, FileText, TrendingUp, FileCode2, ExternalLink, X } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import type { FeedItem } from '../../db/apiClient.ts';
import { SUMMARY_REPORT_LABEL, getDisplayReportLabel } from '../../utils/feedLabels.ts';

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: typeof Newspaper }> = {
  news:     { label: '财经快讯', color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-l-red-400',     icon: Newspaper },
  industry: { label: '行业',     color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-l-blue-400',    icon: BarChart3 },
  podcast:  { label: '播客',     color: 'text-violet-600',  bg: 'bg-violet-50',  border: 'border-l-violet-400',  icon: Mic },
  weekly:   { label: SUMMARY_REPORT_LABEL, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-l-emerald-400', icon: FileText },
  macro:    { label: '宏观',     color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-l-amber-400',   icon: TrendingUp },
  report:   { label: '交互报告', color: 'text-cyan-700',   bg: 'bg-cyan-50',    border: 'border-l-cyan-500',    icon: FileCode2 },
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

function isHtmlReport(item: FeedItem) {
  return item.type === 'report' || item.contentFormat === 'html' || Boolean(item.htmlUrl);
}

function getReportLabel(item: FeedItem) {
  return getDisplayReportLabel(item);
}

interface FeedCardProps {
  item: FeedItem;
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ReportViewer({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col">
      <div className="h-11 shrink-0 border-b border-slate-200 bg-white flex items-center justify-between px-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{item.title}</div>
          <div className="text-[11px] text-slate-500 truncate">
            {[item.category, item.source, item.reportVersion].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {item.htmlUrl && (
            <a
              href={item.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100"
            >
              <ExternalLink size={13} />
              新标签
            </a>
          )}
          <button onClick={onClose} className="p-1.5 rounded text-slate-500 hover:bg-slate-100" title="关闭">
            <X size={16} />
          </button>
        </div>
      </div>
      <iframe
        title={item.title}
        src={item.htmlUrl || undefined}
        srcDoc={item.htmlUrl ? undefined : item.content}
        sandbox="allow-scripts allow-popups allow-forms allow-downloads"
        className="flex-1 w-full border-0 bg-white"
      />
    </div>
  );
}

export const FeedCard = memo(function FeedCard({ item }: FeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const toggleRead = useFeedStore((s) => s.toggleRead);
  const removeFeedItem = useFeedStore((s) => s.removeFeedItem);

  const baseCfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  const cfg = isHtmlReport(item) ? { ...baseCfg, label: getReportLabel(item) } : baseCfg;
  const Icon = cfg.icon;
  const htmlReport = isHtmlReport(item);

  const handleClick = useCallback(() => {
    setExpanded((prev) => !prev);
    if (!item.isRead) toggleRead(item.id);
  }, [item, toggleRead]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    removeFeedItem(item.id);
  }, [item.id, removeFeedItem]);

  // Preview: first few lines
  const plainContent = item.contentFormat === 'html' ? stripHtml(item.content) : item.content;
  const reportMeta = [item.originalName || item.reportKey, item.source, item.reportVersion].filter(Boolean).join(' · ');
  const preview = htmlReport
    ? (reportMeta || `${getReportLabel(item)}，点击打开查看完整页面`)
    : plainContent.split('\n').filter(Boolean).slice(0, 3).join('\n').slice(0, 120);

  return (
    <>
      <div
        onClick={handleClick}
        className={`group relative rounded border-l-[3px] border bg-white cursor-pointer transition-colors hover:border-slate-300 ${cfg.border} ${
          item.isRead ? 'border-slate-100' : 'border-slate-200'
        }`}
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
        {htmlReport ? (
          <div className="text-[11px] text-slate-600 leading-relaxed mt-1">
            {reportMeta || `${getReportLabel(item)}，点击打开查看完整页面`}
          </div>
        ) : expanded ? (
          <div className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-wrap mt-1">
            {plainContent}
          </div>
        ) : (
          <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2 whitespace-pre-wrap">
            {preview}
          </p>
        )}

        {htmlReport && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setReportOpen(true);
              if (!item.isRead) toggleRead(item.id);
            }}
            className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-cyan-600 text-white text-[11px] font-medium hover:bg-cyan-700"
          >
            <ExternalLink size={12} />
            打开
          </button>
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
      {reportOpen && <ReportViewer item={item} onClose={() => setReportOpen(false)} />}
    </>
  );
});
