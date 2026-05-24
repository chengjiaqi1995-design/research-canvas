import { createElement, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { message, Modal, Radio, Select } from 'antd';
import { useCanvasStore } from '../stores/canvasStore.ts';
import { useWorkspaceStore } from '../stores/workspaceStore.ts';
import { canvasApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { CanvasNode } from '../types/index.ts';

interface HtmlAttachmentInput {
  title: string;
  content: string;
  contentFormat?: 'html' | 'markdown' | 'text';
  module?: string;
}

type AttachmentPlacement = 'viewport_center' | 'attachment_stack' | 'origin';

interface PendingAttachment extends HtmlAttachmentInput {
  resolve: (node: CanvasNode | null) => void;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

export function isLikelyHtmlContent(content: string) {
  return /<!doctype\s+html|<html[\s>]|<body[\s>]|<(main|section|article|div|table|style|script|iframe)[\s>]/i.test(content);
}

export function ensureHtmlAttachmentContent(title: string, content: string, htmlUrl?: string) {
  const trimmed = (content || '').trim();
  if (trimmed && isLikelyHtmlContent(trimmed)) return trimmed;

  const safeTitle = escapeHtml(title || 'HTML 附件');
  if (htmlUrl) {
    const safeUrl = escapeAttr(htmlUrl);
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif;background:#fff;color:#172033}
    .fallback{padding:12px;border-bottom:1px solid #e2e8f0;font-size:13px}
    iframe{display:block;width:100%;height:calc(100vh - 45px);border:0}
    a{color:#2563eb;text-decoration:none}
  </style>
</head>
<body>
  <div class="fallback">原始 HTML 文件：<a href="${safeUrl}" target="_blank" rel="noreferrer">${safeUrl}</a></div>
  <iframe src="${safeUrl}" title="${safeTitle}" sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"></iframe>
</body>
</html>`;
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif;background:#fff;color:#172033;line-height:1.7}
    pre{white-space:pre-wrap;word-break:break-word;font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
  </style>
</head>
<body><pre>${escapeHtml(trimmed)}</pre></body>
</html>`;
}

export function useSendHtmlToCanvasAttachment() {
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const [isSending, setIsSending] = useState(false);
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [targetCanvasId, setTargetCanvasId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<AttachmentPlacement>('viewport_center');

  const canvasOptions = useMemo(
    () => canvases.map((canvas) => ({ value: canvas.id, label: canvas.title })),
    [canvases],
  );

  const buildPosition = useCallback((nodes: CanvasNode[], viewport: { x: number; y: number; zoom: number }, selectedPlacement: AttachmentPlacement) => {
    if (selectedPlacement === 'origin') return { x: 0, y: 0 };
    if (selectedPlacement === 'attachment_stack') {
      const attachments = nodes.filter((node) => !node.isMain);
      const maxY = attachments.reduce((max, node) => Math.max(max, node.position?.y ?? 0), -120);
      return { x: 0, y: attachments.length ? maxY + 120 : 0 };
    }

    const zoom = viewport.zoom || 1;
    return {
      x: (-viewport.x + 400) / zoom,
      y: (-viewport.y + 300) / zoom,
    };
  }, []);

  const buildNode = useCallback((input: HtmlAttachmentInput, position: { x: number; y: number }): CanvasNode => {
    const format = input.contentFormat || 'html';
    const title = input.title.trim() || (format === 'html' ? 'HTML 附件' : 'Markdown 附件');
    if (format === 'html') {
      return {
        id: generateId(),
        type: 'html',
        position,
        module: input.module,
        data: {
          type: 'html',
          title,
          content: input.content,
        },
      };
    }

    return {
      id: generateId(),
      type: 'markdown',
      position,
      module: input.module,
      data: {
        type: 'markdown',
        title,
        content: input.content,
      },
    };
  }, []);

  const sendHtmlToCanvas = useCallback(async (input: HtmlAttachmentInput) => {
    const { title, content, module, contentFormat = 'html' } = input;
    const defaultCanvasId = useWorkspaceStore.getState().currentCanvasId || currentCanvasId;
    if (!defaultCanvasId || canvasOptions.length === 0) {
      message.warning('请先选择一个 Canvas 画布');
      return null;
    }

    if (!content.trim()) {
      message.warning('没有可发送的附件内容');
      return null;
    }

    setTargetCanvasId(defaultCanvasId);
    setPlacement('viewport_center');
    return new Promise<CanvasNode | null>((resolve) => {
      setPending({ title, content: content.trim(), module, contentFormat, resolve });
    });
  }, [canvasOptions.length, currentCanvasId]);

  const handleCancel = useCallback(() => {
    pending?.resolve(null);
    setPending(null);
  }, [pending]);

  const handleConfirm = useCallback(async () => {
    if (!pending || !targetCanvasId) return;

    setIsSending(true);
    try {
      const canvasState = useCanvasStore.getState();
      const selectedCanvas = canvases.find((canvas) => canvas.id === targetCanvasId);
      let node: CanvasNode;

      if (canvasState.currentCanvasId === targetCanvasId) {
        const position = buildPosition(canvasState.nodes, canvasState.viewport, placement);
        node = buildNode(pending, position);
        addNode(node);
        selectNode(node.id);
        await useCanvasStore.getState().saveCanvas();
      } else {
        const targetCanvas = await canvasApi.get(targetCanvasId);
        if (!targetCanvas) throw new Error('目标画布不存在');
        const nodes = targetCanvas.nodes || [];
        const position = buildPosition(nodes, targetCanvas.viewport || { x: 0, y: 0, zoom: 1 }, placement);
        node = buildNode(pending, position);
        await canvasApi.update(targetCanvasId, {
          nodes: [...nodes, node],
          updatedAt: Date.now(),
        });
      }

      message.success(`已发送到 ${selectedCanvas?.title || 'Canvas'}：${node.data.title}`);
      pending.resolve(node);
      setPending(null);
      return node;
    } catch (error: any) {
      message.error(`发送到 Canvas 失败：${error?.message || '未知错误'}`);
      pending.resolve(null);
      return null;
    } finally {
      setIsSending(false);
    }
  }, [addNode, buildNode, buildPosition, canvases, pending, placement, selectNode, targetCanvasId]);

  const picker: ReactNode = pending ? createElement(
    Modal,
    {
      title: '发送到 Canvas 附件',
      open: true,
      okText: '发送',
      cancelText: '取消',
      confirmLoading: isSending,
      onOk: handleConfirm,
      onCancel: handleCancel,
      destroyOnClose: true,
    },
    createElement(
      'div',
      { className: 'space-y-4' },
      createElement(
        'div',
        null,
        createElement('div', { className: 'mb-1.5 text-xs font-medium text-slate-500' }, '目标画布'),
        createElement(Select, {
          className: 'w-full',
          value: targetCanvasId || undefined,
          options: canvasOptions,
          placeholder: '选择一个 Canvas 画布',
          onChange: (value: unknown) => setTargetCanvasId(String(value)),
        }),
      ),
      createElement(
        'div',
        null,
        createElement('div', { className: 'mb-1.5 text-xs font-medium text-slate-500' }, '放置位置'),
        createElement(
          Radio.Group,
          {
            className: 'flex flex-col gap-2',
            value: placement,
            onChange: (event: any) => setPlacement(event.target.value),
          },
          createElement(Radio, { value: 'viewport_center' }, '当前视图中心'),
          createElement(Radio, { value: 'attachment_stack' }, '附件列末尾'),
          createElement(Radio, { value: 'origin' }, '画布左上角'),
        ),
      ),
      createElement(
        'div',
        { className: 'rounded bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500' },
        pending.contentFormat === 'html' ? '将作为 HTML 附件写入。' : '将作为 Markdown 附件写入，并在 Canvas 中按 Markdown/BlockNote 渲染。',
      ),
    ),
  ) : null;

  return { isSending, sendHtmlToCanvas, picker };
}
