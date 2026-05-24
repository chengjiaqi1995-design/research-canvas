import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, SyntheticEvent } from 'react';
import {
  BarChart3,
  CheckCheck,
  Clock,
  ExternalLink,
  FileCode2,
  FilePlus2,
  FileText,
  Loader2,
  Mic,
  Newspaper,
  Rss,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { FeedFilters } from './FeedFilters.tsx';
import { formatTime } from './FeedCard.tsx';
import { ResponsiveLayout } from '../layout/ResponsiveLayout.tsx';
import { parseAIMarkdown } from '../../utils/markdownParser.ts';
import { feedApi, notesApi } from '../../db/apiClient.ts';
import type { FeedItem } from '../../db/apiClient.ts';
import * as portfolioApi from '../../aiprocess/api/portfolio.ts';
import type { PortfolioFeedImpact, PortfolioImpactDirection } from '../../aiprocess/types/portfolio.ts';
import { SUMMARY_REPORT_LABEL, getDisplayReportLabel, normalizeSummaryReportLabel } from '../../utils/feedLabels.ts';
import { ensureHtmlAttachmentContent, useSendHtmlToCanvasAttachment } from '../../hooks/useSendHtmlToCanvasAttachment.ts';

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Newspaper }> = {
  news: { label: '财经快讯', color: 'text-red-700', bg: 'bg-red-50', icon: Newspaper },
  industry: { label: '行业报告', color: 'text-blue-700', bg: 'bg-blue-50', icon: BarChart3 },
  podcast: { label: '播客', color: 'text-violet-700', bg: 'bg-violet-50', icon: Mic },
  weekly: { label: SUMMARY_REPORT_LABEL, color: 'text-emerald-700', bg: 'bg-emerald-50', icon: FileText },
  macro: { label: '宏观数据', color: 'text-amber-700', bg: 'bg-amber-50', icon: TrendingUp },
  report: { label: '交互报告', color: 'text-cyan-700', bg: 'bg-cyan-50', icon: FileCode2 },
};

function isHtmlReport(item: FeedItem) {
  return item.contentFormat === 'html' || Boolean(item.htmlUrl);
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getReportLabel(item: FeedItem) {
  if (item.type !== 'report' && !isHtmlReport(item)) return undefined;
  return getDisplayReportLabel(item);
}

function getCategoryLabel(item: FeedItem) {
  return normalizeSummaryReportLabel(item.category, item.type, item.reportType, item.reportTypeLabel, item.title);
}

function applyFeedReportEmbedStyles(doc: Document) {
  doc.documentElement.classList.add('rc-feed-embedded-report');
  if (doc.getElementById('rc-feed-embed-style')) return;

  const style = doc.createElement('style');
  style.id = 'rc-feed-embed-style';
  style.textContent = `
    html.rc-feed-embedded-report,
    html.rc-feed-embedded-report body {
      width: 100% !important;
      min-width: 0 !important;
      overflow-x: auto !important;
    }
    html.rc-feed-embedded-report body {
      margin: 0 !important;
    }
    html.rc-feed-embedded-report body > .page,
    html.rc-feed-embedded-report body > main,
    html.rc-feed-embedded-report body > .container,
    html.rc-feed-embedded-report body > .content,
    html.rc-feed-embedded-report body > .report {
      width: 100% !important;
      max-width: none !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }
    html.rc-feed-embedded-report img,
    html.rc-feed-embedded-report svg,
    html.rc-feed-embedded-report canvas,
    html.rc-feed-embedded-report video {
      max-width: 100%;
    }
    html.rc-feed-embedded-report pre,
    html.rc-feed-embedded-report code {
      white-space: pre-wrap;
      word-break: break-word;
    }
    html.rc-feed-embedded-report a[href^="#ref"],
    html.rc-feed-embedded-report [data-ref],
    html.rc-feed-embedded-report .ref-link {
      cursor: pointer;
    }
    html.rc-feed-embedded-report table {
      max-width: 100%;
    }
    @media (max-width: 900px) {
      html.rc-feed-embedded-report table {
        display: block;
        overflow-x: auto;
      }
    }
  `;
  (doc.head || doc.documentElement).appendChild(style);
}

function getPreview(item: FeedItem) {
  if (isHtmlReport(item)) {
    return [item.originalName || item.reportKey, item.source, item.reportVersion].filter(Boolean).join(' · ') || getReportLabel(item) || '交互报告';
  }
  const content = item.contentFormat === 'html' ? stripHtml(item.content) : item.content;
  return content.split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 140);
}

function getTypeConfig(item: FeedItem) {
  const base = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  if (item.type === 'report' || isHtmlReport(item)) {
    return { ...base, label: getReportLabel(item) || base.label };
  }
  return base;
}

const IMPACT_DIRECTION_LABELS: Record<PortfolioImpactDirection, string> = {
  positive: '正面',
  negative: '负面',
  neutral: '中性',
  mixed: '混合',
};

function impactDirectionClass(direction: PortfolioImpactDirection) {
  if (direction === 'positive') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (direction === 'negative') return 'bg-red-50 text-red-700 border-red-100';
  if (direction === 'mixed') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function FeedImpactStrip({ impacts, loading }: { impacts: PortfolioFeedImpact[]; loading: boolean }) {
  const openAlertCount = impacts.reduce((count, impact) => count + (impact.alerts || []).filter((alert) => alert.status === 'open').length, 0);
  if (!loading && impacts.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-4 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <ShieldAlert size={13} className={openAlertCount ? 'text-red-600' : 'text-slate-400'} />
          Portfolio Impact
        </div>
        <div className="text-[11px] text-slate-400">
          {loading ? '加载中...' : `${impacts.length} impacts · ${openAlertCount} alerts`}
        </div>
      </div>
      {!loading && (
        <div className="flex flex-wrap gap-1.5">
          {impacts.slice(0, 5).map((impact) => {
            const hasAlert = (impact.alerts || []).some((alert) => alert.status === 'open');
            return (
              <span key={impact.id} className={`inline-flex max-w-[260px] items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${hasAlert ? 'border-red-200 bg-red-50 text-red-700' : impactDirectionClass(impact.portfolioDirection)}`}>
                <span className="truncate">{impact.position.nameCn || impact.position.nameEn || impact.position.tickerBbg}</span>
                <span className="shrink-0">{IMPACT_DIRECTION_LABELS[impact.portfolioDirection]}</span>
              </span>
            );
          })}
          {impacts.length > 5 && <span className="text-[11px] text-slate-400">+{impacts.length - 5}</span>}
        </div>
      )}
    </div>
  );
}

type FeedNote = {
  id: string;
  canvasId: string;
  title: string;
  content: string;
  workspaceId: string;
  workspaceName: string;
  date: string | null;
  metadata?: Record<string, string>;
  sourceType?: string;
};

interface ReferencePreviewState {
  itemTitle: string;
  refNumber: number;
  refText: string;
  loading: boolean;
  matches: FeedNote[];
  canOpenInCanvas: boolean;
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

function normalizeForSearch(value: string) {
  return cleanReferenceText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '');
}

function extractReferenceTextFromContent(content: string, refNumber: number) {
  if (!content) return `[REF${refNumber}]`;

  if (typeof DOMParser !== 'undefined' && /<[^>]+>/.test(content)) {
    try {
      const doc = new DOMParser().parseFromString(content, 'text/html');
      const refNode = doc.getElementById(`ref${refNumber}`);
      if (refNode?.textContent) return refNode.textContent.trim();
    } catch {
      // fall through to text matching
    }
  }

  const pattern = new RegExp(`\\[\\s*REF\\s*${refNumber}\\s*\\]\\s*([^\\n]+)`, 'i');
  const match = content.match(pattern);
  return match ? `[REF${refNumber}] ${match[1].trim()}` : `[REF${refNumber}]`;
}

function findBestNoteMatches(notes: FeedNote[], refText: string, limit = 1) {
  const clean = cleanReferenceText(refText);
  const candidates = [clean, ...clean.split('|').map((part) => part.trim())]
    .map((part) => part.replace(/^[-–—\s:：]+/, '').trim())
    .filter((part) => part.length >= 4);
  const normalizedCandidates = Array.from(new Set(candidates.map(normalizeForSearch).filter((part) => part.length >= 4)));

  return notes
    .map((note) => {
      const title = normalizeForSearch(note.title || '');
      const content = normalizeForSearch((note.content || '').slice(0, 3000));
      let score = 0;
      for (const candidate of normalizedCandidates) {
        if (!candidate) continue;
        if (title === candidate) score = Math.max(score, 100);
        else if (title.includes(candidate)) score = Math.max(score, 90);
        else if (candidate.includes(title) && title.length >= 6) score = Math.max(score, 75);
        else if (content.includes(candidate)) score = Math.max(score, 40);
      }
      return { note, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.note);
}

function renderReferenceContent(content: string) {
  const trimmed = content?.trim();
  if (!trimmed) return '<p class="text-slate-400">暂无内容</p>';
  return parseAIMarkdown(trimmed);
}

function transformHtmlReportForFeed(html: string) {
  if (!html || typeof DOMParser === 'undefined') return html;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let changed = false;

    doc.querySelectorAll('section').forEach((section) => {
      const heading = section.querySelector('h2');
      if (!heading?.textContent?.includes('矛盾信号与待验证点')) return;
      const table = section.querySelector('table');
      if (!table) return;

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      if (!rows.length) return;

      const list = doc.createElement('div');
      list.className = 'rc-conflict-list';

      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 3) return;
        const card = doc.createElement('div');
        card.className = 'rc-conflict-item';
        card.innerHTML = `
          <h3>${cells[0].innerHTML}</h3>
          <p><strong>矛盾或风险：</strong>${cells[1].innerHTML}</p>
          <p><strong>下一步验证：</strong>${cells[2].innerHTML}</p>
        `;
        list.appendChild(card);
      });

      if (list.children.length) {
        table.replaceWith(list);
        changed = true;
      }
    });

    applyFeedReportEmbedStyles(doc);

    if (changed) {
      const style = doc.createElement('style');
      style.textContent = `
        .rc-conflict-list { display: grid; gap: 12px; margin-top: 12px; }
        .rc-conflict-item { background: #fff; border: 1px solid #dbe3ee; border-left: 4px solid #b45309; border-radius: 8px; padding: 12px 14px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05); }
        .rc-conflict-item h3 { margin: 0 0 6px; font-size: 16px; color: #111827; }
        .rc-conflict-item p { margin: 5px 0; }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    }
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return html;
  }
}

interface FeedListRowProps {
  item: FeedItem;
  selected: boolean;
  onSelect: (item: FeedItem) => void;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}

const FeedListRow = memo(function FeedListRow({ item, selected, onSelect, onToggleStar, onDelete }: FeedListRowProps) {
  const cfg = getTypeConfig(item);
  const Icon = cfg.icon;

  const handleStar = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleStar(item.id);
  }, [item.id, onToggleStar]);

  const handleDelete = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete(item.id);
  }, [item.id, onDelete]);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`group w-full text-left px-2.5 py-1.5 border-b border-slate-100 transition-colors ${
        selected ? 'bg-blue-50' : item.isRead ? 'bg-white hover:bg-slate-50' : 'bg-white hover:bg-blue-50/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${cfg.bg} ${cfg.color}`} title={cfg.label}>
          <Icon size={12} />
        </div>
        {!item.isRead && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
        <div className="min-w-0 flex-1 truncate">
          <span className={`truncate text-[13px] font-medium leading-5 ${item.isRead ? 'text-slate-700' : 'text-slate-950'}`}>
            {item.title}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">{formatTime(item.publishedAt)}</span>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={handleStar}
            className={`rounded p-1 ${item.isStarred ? 'text-amber-500 opacity-100' : 'text-slate-300 hover:text-amber-500'}`}
            title={item.isStarred ? '取消收藏' : '收藏'}
          >
            <Star size={13} fill={item.isStarred ? 'currentColor' : 'none'} />
          </button>
          <button type="button" onClick={handleDelete} className="rounded p-1 text-slate-300 hover:text-red-500" title="删除">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </button>
  );
});

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-400">
      选择一条信息查看内容
    </div>
  );
}

type FeedStatusFilter = 'all' | 'unread' | 'read' | 'starred';

function statusFilterFrom(filters: { isRead?: string; isStarred?: string }): FeedStatusFilter {
  if (filters.isStarred === 'true') return 'starred';
  if (filters.isRead === 'false') return 'unread';
  if (filters.isRead === 'true') return 'read';
  return 'all';
}

function FeedStatusControls({ unreadCount, onMarkAllRead }: { unreadCount: number; onMarkAllRead: () => void }) {
  const filters = useFeedStore((s) => s.filters);
  const setFilter = useFeedStore((s) => s.setFilter);
  const active = statusFilterFrom(filters);

  const applyStatus = useCallback((status: FeedStatusFilter) => {
    if (status === 'unread') setFilter({ isRead: 'false', isStarred: undefined });
    else if (status === 'read') setFilter({ isRead: 'true', isStarred: undefined });
    else if (status === 'starred') setFilter({ isRead: undefined, isStarred: 'true' });
    else setFilter({ isRead: undefined, isStarred: undefined });
  }, [setFilter]);

  const options: Array<{ value: FeedStatusFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'unread', label: '未读' },
    { value: 'read', label: '已读' },
    { value: 'starred', label: '收藏' },
  ];

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="flex items-center rounded border border-slate-200 bg-slate-50 p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => applyStatus(option.value)}
            className={`rounded px-2 py-0.5 text-[11px] leading-5 transition-colors ${
              active === option.value
                ? option.value === 'starred'
                  ? 'bg-amber-100 font-medium text-amber-700'
                  : 'bg-white font-medium text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={onMarkAllRead}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          title="全部标为已读"
          aria-label="全部标为已读"
        >
          <CheckCheck size={12} />
        </button>
      )}
    </div>
  );
}

function ReferencePreviewModal({
  preview,
  onClose,
  onOpenNote,
}: {
  preview: ReferencePreviewState | null;
  onClose: () => void;
  onOpenNote: (note: FeedNote) => void;
}) {
  if (!preview) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-5 py-5">
      <div className="flex h-[90vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-violet-600">REF{preview.refNumber}</div>
            <h3 className="truncate text-base font-semibold text-slate-950">{preview.itemTitle}</h3>
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
              正在查找对应笔记...
            </div>
          ) : preview.error ? (
            <div className="py-4 text-sm text-red-600">{preview.error}</div>
          ) : preview.matches.length ? (
            <div className="mt-4 space-y-4">
              {preview.matches.map((note) => (
                <div key={`${note.sourceType || 'note'}:${note.canvasId}:${note.id}`} className="rounded border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-950">{note.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {note.workspaceName && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{note.workspaceName}</span>}
                        {note.metadata?.industry && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">{note.metadata.industry}</span>}
                        {note.metadata?.organization && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{note.metadata.organization}</span>}
                        {note.sourceType === 'aiprocess-transcription' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">AI Process 来源</span>}
                        {note.date && <span className="text-[11px] text-slate-400">{note.date}</span>}
                      </div>
                    </div>
                    {preview.canOpenInCanvas ? (
                      <button
                        type="button"
                        onClick={() => onOpenNote(note)}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        <ExternalLink size={12} />
                        打开笔记
                      </button>
                    ) : (
                      <span className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-400">
                        来源预览
                      </span>
                    )}
                  </div>
                  <div
                    className="prose prose-sm max-w-none overflow-visible px-5 py-4 leading-relaxed text-slate-800 prose-headings:text-slate-950 prose-headings:font-bold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-slate-950 prose-hr:my-5"
                    dangerouslySetInnerHTML={{ __html: renderReferenceContent(note.content || '') }}
                  />
                </div>
              ))}
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

interface FeedDetailPaneProps {
  item: FeedItem | undefined;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenReference: (item: FeedItem, refNumber: number, refText?: string) => void;
}

const FeedDetailPane = memo(function FeedDetailPane({ item, onToggleStar, onDelete, onOpenReference }: FeedDetailPaneProps) {
  if (!item) return <EmptyDetail />;

  const cfg = getTypeConfig(item);
  const Icon = cfg.icon;
  const html = isHtmlReport(item);
  const body = item.contentFormat === 'html' && !html ? stripHtml(item.content) : item.content;
  const [portfolioImpacts, setPortfolioImpacts] = useState<PortfolioFeedImpact[]>([]);
  const [portfolioImpactLoading, setPortfolioImpactLoading] = useState(false);
  const renderedMarkdown = item.contentFormat === 'text' ? '' : parseAIMarkdown(body);
  const displayHtml = useMemo(
    () => (html && !item.htmlUrl ? transformHtmlReportForFeed(item.content) : item.content),
    [html, item.content, item.htmlUrl],
  );
  const { isSending, sendHtmlToCanvas, picker } = useSendHtmlToCanvasAttachment();
  const canSendToCanvas = item.type === 'report' || html;
  const handleSendToCanvas = useCallback(() => {
    const contentFormat = html ? 'html' : (item.contentFormat === 'text' ? 'text' : 'markdown');
    void sendHtmlToCanvas({
      title: item.title,
      content: html ? ensureHtmlAttachmentContent(item.title, item.content, item.htmlUrl || undefined) : item.content,
      contentFormat,
    });
  }, [html, item.content, item.contentFormat, item.htmlUrl, item.title, sendHtmlToCanvas]);

  useEffect(() => {
    let cancelled = false;
    setPortfolioImpactLoading(true);
    portfolioApi.getPortfolioImpacts({ feedItemId: item.id, days: 365, limit: 50 })
      .then((res) => {
        if (!cancelled) setPortfolioImpacts(res.data.data.impacts || []);
      })
      .catch(() => {
        if (!cancelled) setPortfolioImpacts([]);
      })
      .finally(() => {
        if (!cancelled) setPortfolioImpactLoading(false);
      });
    return () => { cancelled = true; };
  }, [item.id]);

  const handleMarkdownClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const refNode = target.closest<HTMLElement>('[data-ref], .ref-link');
    if (!refNode) return;
    const raw = refNode.dataset.ref || refNode.textContent || '';
    const match = raw.match(/\d+/);
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenReference(item, Number(match[0]), extractReferenceTextFromContent(item.content, Number(match[0])));
  }, [item, onOpenReference]);

  const handleHtmlFrameLoad = useCallback((event: SyntheticEvent<HTMLIFrameElement>) => {
    const frame = event.currentTarget;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc || (doc as Document & { __rcRefHandlerAttached?: boolean }).__rcRefHandlerAttached) return;
    applyFeedReportEmbedStyles(doc);
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
      onOpenReference(item, refNumber, refText);
    });
  }, [item, onOpenReference]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white max-md:h-auto max-md:min-h-0 max-md:overflow-visible">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cfg.bg} ${cfg.color}`}>
                <Icon size={12} />
                {cfg.label}
              </span>
              {item.category && <span className="text-[11px] text-slate-500">{getCategoryLabel(item)}</span>}
              {item.source && <span className="text-[11px] text-slate-400">{item.source}</span>}
            </div>
            <h2 className="truncate text-[17px] font-semibold leading-6 text-slate-950">{item.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {formatTime(item.publishedAt)}
              </span>
              {item.originalName && <span className="truncate">{item.originalName}</span>}
              {item.reportTypeLabel && <span className="truncate">{getReportLabel(item)}</span>}
              {item.reportVersion && <span className="truncate">{item.reportVersion}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canSendToCanvas && (
              <button
                type="button"
                onClick={handleSendToCanvas}
                disabled={isSending}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                title="发送到 Canvas 附件"
              >
                {isSending ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />}
                Canvas 附件
              </button>
            )}
            {html && item.htmlUrl && (
              <a
                href={item.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                <ExternalLink size={13} />
                新标签
              </a>
            )}
            <button
              type="button"
              onClick={() => onToggleStar(item.id)}
              className={`rounded p-1.5 ${item.isStarred ? 'text-amber-500' : 'text-slate-400 hover:bg-slate-100 hover:text-amber-500'}`}
              title={item.isStarred ? '取消收藏' : '收藏'}
            >
              <Star size={15} fill={item.isStarred ? 'currentColor' : 'none'} />
            </button>
            <button type="button" onClick={() => onDelete(item.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="删除">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>

      <FeedImpactStrip impacts={portfolioImpacts} loading={portfolioImpactLoading} />

      {html ? (
        <iframe
          key={`${item.id}:${item.reportVersion || item.updatedAt}`}
          title={item.title}
          src={item.htmlUrl || undefined}
          srcDoc={item.htmlUrl ? undefined : displayHtml}
          onLoad={handleHtmlFrameLoad}
          sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
          className="h-0 min-h-0 w-full flex-1 border-0 bg-white max-md:h-[72dvh] max-md:min-h-[72dvh] max-md:flex-none"
        />
      ) : (
        <div
          className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 outline-none max-md:h-auto max-md:flex-none max-md:overflow-visible max-md:overscroll-auto max-md:px-4"
          tabIndex={0}
          aria-label="信息流正文"
          onClick={handleMarkdownClick}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {item.contentFormat === 'text' ? (
            <article className="max-w-4xl whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">
              {body}
            </article>
          ) : (
            <article
              className="prose prose-sm max-w-4xl break-words text-slate-800 leading-relaxed prose-headings:text-slate-950 prose-headings:font-bold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-a:text-blue-600 prose-strong:text-slate-950 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
            />
          )}
          {item.tags && item.tags.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
                <Tag size={12} />
                标签
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {picker}
    </section>
  );
});

export const FeedView = memo(function FeedView() {
  const items = useFeedStore((s) => s.items);
  const total = useFeedStore((s) => s.total);
  const isLoading = useFeedStore((s) => s.isLoading);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const loadMore = useFeedStore((s) => s.loadMore);
  const markAllRead = useFeedStore((s) => s.markAllRead);
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const toggleRead = useFeedStore((s) => s.toggleRead);
  const removeFeedItem = useFeedStore((s) => s.removeFeedItem);
  const setViewMode = useAICardStore((s) => s.setViewMode);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [referencePreview, setReferencePreview] = useState<ReferencePreviewState | null>(null);
  const notesCacheRef = useRef<FeedNote[] | null>(null);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      loadMore();
    }
  }, [loadMore]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId), [items, selectedId]);
  const unreadCount = items.filter((i) => !i.isRead).length;

  const handleSelect = useCallback((item: FeedItem) => {
    setSelectedId(item.id);
    if (!item.isRead) void toggleRead(item.id);
  }, [toggleRead]);

  const handleDelete = useCallback((id: string) => {
    if (confirm('确定删除这条信息？')) {
      void removeFeedItem(id);
    }
  }, [removeFeedItem]);

  const handleToggleStar = useCallback((id: string) => {
    void toggleStar(id);
  }, [toggleStar]);

  const handleOpenReference = useCallback((item: FeedItem, refNumber: number, refText?: string) => {
    const initialText = refText || extractReferenceTextFromContent(item.content, refNumber);
    setReferencePreview({
      itemTitle: item.title,
      refNumber,
      refText: initialText,
      loading: true,
      matches: [],
      canOpenInCanvas: false,
    });

    (async () => {
      try {
        const feedReference = await feedApi.getReference(item.id, refNumber, initialText).catch(() => null);
        if (feedReference?.note) {
          const directNote = feedReference.note;
          const canOpenInCanvas = Boolean(
            directNote.canvasId &&
            directNote.workspaceId &&
            directNote.sourceType !== 'aiprocess-transcription',
          );

          setReferencePreview((current) => {
            if (!current || current.itemTitle !== item.title || current.refNumber !== refNumber) return current;
            return {
              ...current,
              loading: false,
              refText: feedReference.refText || initialText,
              matches: [directNote],
              canOpenInCanvas,
              canOpenInAIProcess: Boolean(feedReference.canOpenInAIProcess),
            };
          });
          return;
        }

        const referenceResponse = await notesApi.searchReference(initialText, 1);
        let matches = referenceResponse.notes || [];
        let canOpenInCanvas = Boolean(referenceResponse.canOpenInCanvas);

        const loadReferenceNotes = async (force = false) => {
          if (force || !notesCacheRef.current || notesCacheRef.current.length === 0) {
            const response = await notesApi.query([], [], '2000-01-01', '2100-12-31', 'created');
            notesCacheRef.current = response.notes || [];
          }
          return notesCacheRef.current;
        };

        if (!matches.length) {
          const notes = await loadReferenceNotes();
          matches = findBestNoteMatches(notes, initialText, 1);
          if (matches.length) canOpenInCanvas = true;
        }

        if (!matches.length && notesCacheRef.current && notesCacheRef.current.length > 0) {
          const response = await notesApi.query([], [], '2000-01-01', '2100-12-31', 'created');
          notesCacheRef.current = response.notes || [];
          matches = findBestNoteMatches(notesCacheRef.current, initialText, 1);
          if (matches.length) canOpenInCanvas = true;
        }

        setReferencePreview((current) => {
          if (!current || current.itemTitle !== item.title || current.refNumber !== refNumber) return current;
          return { ...current, loading: false, matches, canOpenInCanvas };
        });
      } catch (error: any) {
        setReferencePreview((current) => {
          if (!current || current.itemTitle !== item.title || current.refNumber !== refNumber) return current;
          return { ...current, loading: false, matches: [], error: error?.message || '引用笔记加载失败' };
        });
      }
    })();
  }, []);

  const handleOpenNote = useCallback(async (note: FeedNote) => {
    setReferencePreview(null);
    setViewMode('canvas');

    const workspaceStore = useWorkspaceStore.getState();
    if (workspaceStore.currentWorkspaceId !== note.workspaceId) {
      workspaceStore.setCurrentWorkspace(note.workspaceId);
      await workspaceStore.loadCanvases(note.workspaceId);
    }
    useWorkspaceStore.getState().setCurrentCanvas(note.canvasId);
    await useCanvasStore.getState().loadCanvas(note.canvasId);
    useCanvasStore.getState().selectNode(note.id);
  }, [setViewMode]);

  return (
    <ResponsiveLayout sidebar={<FeedFilters />} sidebarWidth={200} drawerTitle="信息流筛选" mobileOpenerView="feed">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="h-0 min-h-0 flex-1 overflow-hidden bg-slate-100/70 p-2 max-md:h-auto max-md:min-h-full max-md:overflow-visible max-md:p-0">
          <div className="flex h-full min-w-0 overflow-hidden rounded border border-slate-200 bg-white max-md:h-auto max-md:min-h-full max-md:flex-col max-md:overflow-visible max-md:rounded-none max-md:border-x-0">
            <aside className="flex w-[390px] shrink-0 flex-col border-r border-slate-200 bg-white max-[1050px]:w-[330px] max-md:h-[42dvh] max-md:w-full max-md:border-r-0 max-md:border-b">
              <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <Rss size={15} className="text-slate-500" />
                    列表
                  </div>
                  <FeedStatusControls unreadCount={unreadCount} onMarkAllRead={markAllRead} />
                </div>
                <div className="shrink-0 text-[11px] text-slate-500">{items.length} / {total}</div>
              </div>

              <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
                {items.length === 0 && !isLoading && (
                  <div className="flex h-48 items-center justify-center text-sm text-slate-400">
                    暂无信息
                  </div>
                )}

                {items.map((item) => (
                  <FeedListRow
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onSelect={handleSelect}
                    onToggleStar={handleToggleStar}
                    onDelete={handleDelete}
                  />
                ))}

                {isLoading && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={18} className="animate-spin text-slate-400" />
                  </div>
                )}

                {!isLoading && items.length > 0 && items.length < total && (
                  <button onClick={loadMore} className="w-full py-3 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700">
                    加载更多
                  </button>
                )}
              </div>
            </aside>

            <FeedDetailPane
              item={selectedItem}
              onToggleStar={handleToggleStar}
              onDelete={handleDelete}
              onOpenReference={handleOpenReference}
            />
          </div>
        </div>
      </div>
      <ReferencePreviewModal preview={referencePreview} onClose={() => setReferencePreview(null)} onOpenNote={handleOpenNote} />
    </ResponsiveLayout>
  );
});
