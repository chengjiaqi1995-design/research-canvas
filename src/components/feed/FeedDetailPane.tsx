import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, SyntheticEvent } from 'react';
import { Clock, Database, ExternalLink, Loader2, Star, Tag, Trash2 } from 'lucide-react';
import { message } from 'antd';
import type { FeedItem } from '../../db/apiClient.ts';
import * as portfolioApi from '../../aiprocess/api/portfolio.ts';
import type { PortfolioFeedImpact } from '../../aiprocess/types/portfolio.ts';
import { useAuthStore } from '../../stores/authStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useMermaidRender } from '../../hooks/useMermaidRender.ts';
import { parseAIMarkdown } from '../../utils/markdownParser.ts';
import { renderMermaidInElement } from '../../utils/mermaidRenderer.ts';
import { createHtmlNode, createMarkdownNode } from '../../canvas/canvasNodeFactory.ts';
import type { CanvasNode, HtmlNodeData, MarkdownNodeData, NodeData } from '../../types/index.ts';
import {
  formatFeedTime,
  getFeedAttachmentMetadata,
  getFeedAttachmentTitle,
  getFeedCategoryLabel,
  getFeedReportLabel,
  isCanvasSendableFeedItem,
  isHtmlReportFeedItem,
  stripHtml,
} from '../../feed/feedItemModel.ts';
import { applyFeedReportEmbedStyles, transformHtmlReportForFeed } from '../../feed/feedReportHtml.ts';
import { extractReferenceTextFromContent } from '../../feed/feedReference.ts';
import { FeedImpactStrip } from './FeedImpactStrip.tsx';
import { getFeedTypeConfig } from './feedTypeConfig.ts';

interface FeedDetailPaneProps {
  item: FeedItem | undefined;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenReference: (item: FeedItem, refNumber: number, refText?: string) => void;
}

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-400">
      选择一条信息查看内容
    </div>
  );
}

function getMetadata(data: NodeData) {
  return 'metadata' in data && data.metadata ? data.metadata : {};
}

function buildFeedAttachmentNode(
  item: FeedItem,
  html: boolean,
  content: string,
  position: { x: number; y: number },
) {
  const title = getFeedAttachmentTitle(item);
  const metadata = getFeedAttachmentMetadata(item);
  const tags = item.tags || [];
  const node = html
    ? createHtmlNode(position, { title, content })
    : createMarkdownNode(position, { title, content });

  if (node.data.type === 'html') {
    node.data = { ...node.data, metadata, tags } satisfies HtmlNodeData;
  } else if (node.data.type === 'markdown') {
    node.data = { ...node.data, metadata, tags } satisfies MarkdownNodeData;
  }

  return node;
}

function canvasCenterPosition(nodes: CanvasNode[], viewport: { x: number; y: number; zoom: number }) {
  const viewportX = viewport?.x || 0;
  const viewportY = viewport?.y || 0;
  const zoom = viewport?.zoom || 1;
  const centerX = -viewportX / zoom + window.innerWidth / (2 * zoom);
  const centerY = -viewportY / zoom + window.innerHeight / (2 * zoom);
  const attachmentCount = nodes.filter((node) => !node.isMain).length;

  return {
    x: centerX - 240 + (attachmentCount % 4) * 24,
    y: centerY - 160 + (attachmentCount % 4) * 24,
  };
}

function FeedDetailContent({
  item,
  onToggleStar,
  onDelete,
  onOpenReference,
}: FeedDetailPaneProps & { item: FeedItem }) {
  const readOnly = useAuthStore((s) => s.user?.readOnly === true);
  const cfg = getFeedTypeConfig(item);
  const Icon = cfg.icon;
  const html = isHtmlReportFeedItem(item);
  const canSendToCanvas = isCanvasSendableFeedItem(item);
  const body = item.contentFormat === 'html' && !html ? stripHtml(item.content) : item.content;
  const [sendingToCanvas, setSendingToCanvas] = useState(false);
  const [portfolioImpacts, setPortfolioImpacts] = useState<PortfolioFeedImpact[]>([]);
  const [portfolioImpactLoading, setPortfolioImpactLoading] = useState(false);
  const renderedMarkdown = item.contentFormat === 'text' ? '' : parseAIMarkdown(body);
  const markdownArticleRef = useRef<HTMLElement>(null);
  useMermaidRender(markdownArticleRef, [item.id, renderedMarkdown]);
  const displayHtml = useMemo(
    () => (html && !item.htmlUrl ? transformHtmlReportForFeed(item.content) : item.content),
    [html, item.content, item.htmlUrl],
  );

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
    void renderMermaidInElement(doc);
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

  const handleSendToCanvas = useCallback(async () => {
    if (!canSendToCanvas || sendingToCanvas) return;
    if (readOnly) {
      message.warning('只读模式不能发送到 Canvas 附件');
      return;
    }

    const content = html
      ? item.content || (item.htmlUrl ? `<p><a href="${item.htmlUrl}" target="_blank" rel="noreferrer">${item.htmlUrl}</a></p>` : '')
      : item.content;

    if (!content?.trim()) {
      message.warning('当前信息流没有可发送的正文内容');
      return;
    }

    setSendingToCanvas(true);
    try {
      const workspaceState = useWorkspaceStore.getState();
      const initialCanvasState = useCanvasStore.getState();
      const targetCanvasId = initialCanvasState.currentCanvasId || workspaceState.currentCanvasId;

      if (!targetCanvasId) {
        message.warning('请先在 Canvas 打开一个目标画布，再发送附件');
        return;
      }

      if (initialCanvasState.currentCanvasId !== targetCanvasId) {
        await initialCanvasState.loadCanvas(targetCanvasId);
      }

      const canvasState = useCanvasStore.getState();
      if (canvasState.currentCanvasId !== targetCanvasId) {
        message.warning('目标 Canvas 加载失败，请先打开目标画布后重试');
        return;
      }

      const sourceId = `feed:${item.id}`;
      const existing = canvasState.nodes.find((node) => {
        const meta = getMetadata(node.data);
        return meta.feedItemId === item.id || meta.sourceId === sourceId;
      });

      if (existing) {
        canvasState.selectNode(existing.id);
        message.info('这条信息流已在当前 Canvas 附件中');
        return;
      }

      const node = buildFeedAttachmentNode(
        item,
        html,
        content,
        canvasCenterPosition(canvasState.nodes, canvasState.viewport),
      );

      canvasState.addNode(node);
      useCanvasStore.getState().selectNode(node.id);
      await useCanvasStore.getState().saveCanvas();
      message.success('已发送到当前 Canvas 附件');
    } catch (error: unknown) {
      message.error(`发送失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSendingToCanvas(false);
    }
  }, [canSendToCanvas, html, item, readOnly, sendingToCanvas]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white max-md:h-full max-md:min-h-0">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${cfg.bg} ${cfg.color}`}>
                <Icon size={12} />
                {cfg.label}
              </span>
              {item.category && <span className="text-[11px] text-slate-500">{getFeedCategoryLabel(item)}</span>}
              {item.source && <span className="text-[11px] text-slate-400">{item.source}</span>}
            </div>
            <h2 className="truncate text-[17px] font-semibold leading-6 text-slate-950">{item.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {formatFeedTime(item.publishedAt)}
              </span>
              {item.originalName && <span className="truncate">{item.originalName}</span>}
              {item.reportTypeLabel && <span className="truncate">{getFeedReportLabel(item)}</span>}
              {item.reportVersion && <span className="truncate">{item.reportVersion}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canSendToCanvas && (
              <button
                type="button"
                onClick={handleSendToCanvas}
                disabled={sendingToCanvas || readOnly}
                className="inline-flex items-center gap-1 rounded border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="发送到当前 Canvas 附件"
              >
                {sendingToCanvas ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
                <span className="max-sm:hidden">Canvas 附件</span>
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
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
          className="h-0 min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <div
          className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 outline-none"
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
              ref={markdownArticleRef}
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
    </section>
  );
}

export const FeedDetailPane = memo(function FeedDetailPane(props: FeedDetailPaneProps) {
  if (!props.item) return <EmptyDetail />;

  return (
    <FeedDetailContent
      item={props.item}
      onToggleStar={props.onToggleStar}
      onDelete={props.onDelete}
      onOpenReference={props.onOpenReference}
    />
  );
});
