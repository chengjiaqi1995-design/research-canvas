import { memo, useCallback, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Star, Trash2, ChevronDown, ChevronUp, Newspaper, BarChart3, Mic, FileText, TrendingUp, FileCode2, ExternalLink, FilePlus2, Loader2, X } from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { feedApi } from '../../db/apiClient.ts';
import type { FeedItem } from '../../db/apiClient.ts';
import { parseAIMarkdown } from '../../utils/markdownParser.ts';
import { SUMMARY_REPORT_LABEL, getDisplayReportLabel } from '../../utils/feedLabels.ts';
import { ensureHtmlAttachmentContent, useSendHtmlToCanvasAttachment } from '../../hooks/useSendHtmlToCanvasAttachment.ts';

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
  return item.contentFormat === 'html' || Boolean(item.htmlUrl);
}

function getReportLabel(item: FeedItem) {
  if (item.type !== 'report' && !isHtmlReport(item)) return undefined;
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

type FeedReferenceNote = NonNullable<Awaited<ReturnType<typeof feedApi.getReference>>['note']>;

interface ReportReferencePreview {
  refNumber: number;
  refText: string;
  loading: boolean;
  note: FeedReferenceNote | null;
  canOpenInAIProcess?: boolean;
  error?: string;
}

function cleanReferenceText(text: string, refNumber?: number) {
  const refPattern = refNumber ? new RegExp(`\\[\\s*REF\\s*${refNumber}\\s*\\]`, 'i') : /\[\s*REF\s*\d+\s*\]/gi;
  return stripHtml(text)
    .replace(refPattern, '')
    .replace(/^[-–—\s:：|]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderReferenceContent(content: string) {
  const trimmed = content?.trim();
  if (!trimmed) return '<p class="text-slate-400">暂无内容</p>';
  return parseAIMarkdown(trimmed);
}

function applyReportReferenceStyles(doc: Document) {
  if (doc.getElementById('rc-report-reference-style')) return;

  const style = doc.createElement('style');
  style.id = 'rc-report-reference-style';
  style.textContent = `
    a[href^="#ref"], [data-ref], .ref-link {
      cursor: pointer !important;
      color: #2563eb !important;
      text-decoration: underline !important;
      text-underline-offset: 2px !important;
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

function ReferencePreviewModal({
  preview,
  onClose,
}: {
  preview: ReportReferencePreview | null;
  onClose: () => void;
}) {
  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 px-5 py-5">
      <div className="flex h-[90vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-violet-600">REF{preview.refNumber}</div>
            <h3 className="truncate text-base font-semibold text-slate-950">
              {preview.note?.title || cleanReferenceText(preview.refText, preview.refNumber) || `[REF${preview.refNumber}]`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded border border-violet-100 bg-violet-50 px-3 py-2 text-sm leading-6 text-slate-800">
            {cleanReferenceText(preview.refText, preview.refNumber) || `[REF${preview.refNumber}]`}
          </div>

          {preview.loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              正在加载对应笔记...
            </div>
          ) : preview.error ? (
            <div className="py-4 text-sm text-red-600">{preview.error}</div>
          ) : preview.note ? (
            <div className="mt-4 rounded border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
                {preview.note.workspaceName && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{preview.note.workspaceName}</span>}
                {preview.note.metadata?.industry && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{preview.note.metadata.industry}</span>}
                {preview.note.metadata?.organization && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{preview.note.metadata.organization}</span>}
                {preview.note.sourceType === 'aiprocess-transcription' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">AI Process 来源</span>}
                {preview.canOpenInAIProcess && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">可在 AI Process 打开</span>}
                {preview.note.date && <span className="text-[11px] text-slate-400">{preview.note.date}</span>}
              </div>
              <div
                className="prose prose-sm max-w-none overflow-visible px-5 py-4 leading-relaxed text-slate-800 prose-headings:text-slate-950 prose-headings:font-bold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-slate-950 prose-hr:my-5"
                dangerouslySetInnerHTML={{ __html: renderReferenceContent(preview.note.content || '') }}
              />
            </div>
          ) : (
            <div className="py-4 text-sm text-slate-500">
              未自动匹配到完整笔记。当前报告只提供了 REF 文本，缺少稳定的 note id。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportViewer({ item, onClose }: { item: FeedItem; onClose: () => void }) {
  const [referencePreview, setReferencePreview] = useState<ReportReferencePreview | null>(null);
  const { isSending, sendHtmlToCanvas, picker } = useSendHtmlToCanvasAttachment();

  const handleSendToCanvas = useCallback(() => {
    void sendHtmlToCanvas({
      title: item.title,
      content: ensureHtmlAttachmentContent(item.title, item.content, item.htmlUrl || undefined),
      contentFormat: 'html',
    });
  }, [item.content, item.htmlUrl, item.title, sendHtmlToCanvas]);

  const handleOpenReference = useCallback((refNumber: number, refText?: string) => {
    const initialText = refText || `[REF${refNumber}]`;
    setReferencePreview({
      refNumber,
      refText: initialText,
      loading: true,
      note: null,
    });

    (async () => {
      try {
        const feedReference = await feedApi.getReference(item.id, refNumber, initialText);
        setReferencePreview((current) => {
          if (!current || current.refNumber !== refNumber) return current;
          return {
            ...current,
            loading: false,
            refText: feedReference.refText || initialText,
            note: feedReference.note,
            canOpenInAIProcess: Boolean(feedReference.canOpenInAIProcess),
          };
        });
      } catch (error: any) {
        setReferencePreview((current) => {
          if (!current || current.refNumber !== refNumber) return current;
          return { ...current, loading: false, error: error?.message || '引用笔记加载失败' };
        });
      }
    })();
  }, [item.id]);

  const handleFrameLoad = useCallback((event: SyntheticEvent<HTMLIFrameElement>) => {
    const frame = event.currentTarget;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }

    if (!doc || (doc as Document & { __rcRefHandlerAttached?: boolean }).__rcRefHandlerAttached) return;
    applyReportReferenceStyles(doc);
    (doc as Document & { __rcRefHandlerAttached?: boolean }).__rcRefHandlerAttached = true;

    doc.addEventListener('click', (clickEvent) => {
      const target = clickEvent.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest<HTMLElement>('a[href^="#ref"], [data-ref], .ref-link');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      const raw = link.dataset.ref || href || link.textContent || '';
      const match = raw.match(/ref\s*(\d+)|(\d+)/i);
      const refNumber = match ? Number(match[1] || match[2]) : 0;
      if (!refNumber) return;

      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      const refText = doc.getElementById(`ref${refNumber}`)?.textContent?.trim() || link.textContent?.trim() || `[REF${refNumber}]`;
      handleOpenReference(refNumber, refText);
    });
  }, [handleOpenReference]);

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
          <button
            type="button"
            onClick={handleSendToCanvas}
            disabled={isSending}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            title="发送到 Canvas 附件"
          >
            {isSending ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />}
            Canvas 附件
          </button>
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
        onLoad={handleFrameLoad}
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
        className="flex-1 w-full border-0 bg-white"
      />
      <ReferencePreviewModal preview={referencePreview} onClose={() => setReferencePreview(null)} />
      {picker}
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
  const cfg = item.type === 'report' || isHtmlReport(item) ? { ...baseCfg, label: getReportLabel(item) || baseCfg.label } : baseCfg;
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
