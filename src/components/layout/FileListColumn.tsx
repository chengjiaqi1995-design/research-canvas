import { memo, useState, useRef, useCallback, useMemo, useEffect, type MouseEvent, type PointerEvent } from 'react';
import {
  Trash2,
  FileText,
  FilePlus,
  Table,
  FileSpreadsheet,
  FileSearch,
  BookOpen,
  FileCode2,
  Globe,
  Loader2,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useAuthStore } from '../../stores/authStore.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import type { CanvasNode } from '../../types/index.ts';
import { pdfApi, fileApi } from '../../db/apiClient.ts';
import { marked } from 'marked';
import { TableOfContents } from './TableOfContents.tsx';
import { IconButton, ListItem } from '../ui/index.ts';
import { CanvasTrashModal } from './CanvasTrashModal.tsx';

/** Get unified icon for a file node type */
function FileIcon({ type }: { type: string }) {
  switch (type) {
    case 'table':
      return <Table size={12} className="shrink-0 text-emerald-500" strokeWidth={2} />;
    case 'pdf':
      return <BookOpen size={12} className="shrink-0 text-violet-500" strokeWidth={2} />;
    case 'markdown':
      return <FileCode2 size={12} className="shrink-0 text-blue-500" strokeWidth={2} />;
    case 'html':
      return <Globe size={12} className="shrink-0 text-amber-500" strokeWidth={2} />;
    case 'text':
    default:
      return <FileText size={12} className="shrink-0 text-blue-400" strokeWidth={2} />;
  }
}

interface FileListColumnProps {
  headerless?: boolean;
}

type AttachmentSource = 'expert' | 'sellside';
type SourceFilter = AttachmentSource | 'all';

const SOURCE_BADGES: Record<AttachmentSource, { label: string; title: string; className: string }> = {
  expert: {
    label: 'E',
    title: 'Expert 来源',
    className: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  sellside: {
    label: 'S',
    title: 'Sellside 来源',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
  },
};

function normalizeAttachmentSource(value: unknown): AttachmentSource | null {
  const normalized = String(value || '').toLowerCase().trim();
  if (!normalized) return null;
  const compact = normalized.replace(/[\s_\-./|,，、;；:：()[\]{}]+/g, '');
  if (compact.includes('sellside') || compact.includes('卖方')) return 'sellside';
  if (compact.includes('expert') || compact.includes('专家')) return 'expert';
  return null;
}

function getAttachmentSource(node: CanvasNode): AttachmentSource | null {
  const data = node.data as unknown as {
    metadata?: Record<string, unknown>;
    tags?: unknown;
    participants?: unknown;
    speakerType?: unknown;
    sourceType?: unknown;
    noteType?: unknown;
    [key: string]: unknown;
  };
  const metadata = data.metadata || {};
  const speakerTypeCandidates = [
    metadata.speakerType,
    metadata['演讲人类型'],
    metadata.participantType,
    metadata['参与人类型'],
    metadata.participants,
    metadata['参与人'],
    data.speakerType,
    data['演讲人类型'],
    data.participantType,
    data['参与人类型'],
    data.participants,
    data['参与人'],
  ];
  for (const candidate of speakerTypeCandidates) {
    const source = normalizeAttachmentSource(candidate);
    if (source) return source;
  }

  const fallbackCandidates = [
    metadata.sourceType,
    metadata['来源类型'],
    metadata.noteType,
    metadata['类型'],
    data.sourceType,
    data['来源类型'],
    data.noteType,
    data['类型'],
  ];
  if (Array.isArray(data.tags)) fallbackCandidates.push(...data.tags);
  if (Array.isArray(metadata.tags)) fallbackCandidates.push(...metadata.tags);

  for (const candidate of fallbackCandidates) {
    const source = normalizeAttachmentSource(candidate);
    if (source) return source;
  }
  return null;
}

function parseTimestampValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  const normalized = /^\d{4}\/\d{1,2}\/\d{1,2}/.test(raw) ? raw.replace(/\//g, '-') : raw;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getAttachmentDate(node: CanvasNode): { timestamp: number; label: string; title: string } | null {
  const data = node.data as unknown as Record<string, unknown> & { metadata?: Record<string, unknown> };
  const metadata = data.metadata || {};
  const candidates: { value: unknown; label: string }[] = [
    { value: metadata.eventDate, label: '发生日期' },
    { value: metadata['发生日期'], label: '发生日期' },
    { value: metadata.date, label: '发生日期' },
    { value: metadata['日期'], label: '发生日期' },
    { value: metadata.publishedAt, label: '发布时间' },
    { value: metadata['发布时间'], label: '发布时间' },
    { value: data.updatedAt, label: '最后编辑' },
    { value: (node as CanvasNode & { updatedAt?: unknown }).updatedAt, label: '最后编辑' },
    { value: metadata.updatedAt, label: '最后编辑' },
    { value: metadata['更新时间'], label: '最后编辑' },
    { value: metadata['修改时间'], label: '最后编辑' },
    { value: metadata.migratedAt, label: '迁移时间' },
    { value: data.createdAt, label: '创建时间' },
    { value: metadata.createdAt, label: '创建时间' },
    { value: metadata['创建时间'], label: '创建时间' },
  ];

  for (const candidate of candidates) {
    const timestamp = parseTimestampValue(candidate.value);
    if (timestamp) {
      const date = new Date(timestamp);
      return {
        timestamp,
        label: date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
        title: `${candidate.label}: ${date.toLocaleString('zh-CN', { hour12: false })}`,
      };
    }
  }
  return null;
}

export const FileListColumn = memo(function FileListColumn({ headerless }: FileListColumnProps = {}) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const readOnly = useAuthStore((s) => s.user?.readOnly === true);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const loadCanvases = useWorkspaceStore((s) => s.loadCanvases);

  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const deleteNodeAndSave = useCanvasStore((s) => s.deleteNodeAndSave);
  const { addTextNode, addTableNode, addHtmlNode, addMarkdownNode } = useCanvas();

  // File import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfViewInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const [pdfConvertLoading, setPdfConvertLoading] = useState(false);
  const [pdfUploadLoading, setPdfUploadLoading] = useState(false);
  const [excelImportLoading, setExcelImportLoading] = useState(false);
  const [deletingNodeIds, setDeletingNodeIds] = useState<Set<string>>(() => new Set());
  const [showTrash, setShowTrash] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  // Refresh canvases on tab visible
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === 'visible') {
        const wsId = useWorkspaceStore.getState().currentWorkspaceId;
        if (wsId) loadCanvases(wsId);
      }
    };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [loadCanvases]);

  useEffect(() => {
    setDeletingNodeIds((prev) => {
      if (prev.size === 0) return prev;
      const liveNodeIds = new Set(nodes.map((node) => node.id));
      const next = new Set(Array.from(prev).filter((id) => liveNodeIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [nodes]);

  const canvasFiles = useMemo(() => nodes.filter((n) => !n.isMain), [nodes]);
  const filteredCanvasFiles = useMemo(() => (
    sourceFilter === 'all'
      ? canvasFiles
      : canvasFiles.filter((node) => getAttachmentSource(node) === sourceFilter)
  ), [canvasFiles, sourceFilter]);

  const stopDeletePressEvent = useCallback((e: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
  }, []);

  const handleDeleteNode = useCallback((e: MouseEvent<HTMLButtonElement>, node: CanvasNode) => {
    e.preventDefault();
    e.stopPropagation();
    const title = String(node.data.title || '未命名附件');
    const confirmed = window.confirm(`确定删除附件「${title}」吗？`);
    if (!confirmed) return;

    setDeletingNodeIds((prev) => {
      const next = new Set(prev);
      next.add(node.id);
      return next;
    });

    void deleteNodeAndSave(node.id)
      .then(async () => {
        const wsId = useWorkspaceStore.getState().currentWorkspaceId;
        if (wsId) await loadCanvases(wsId);
      })
      .catch((err) => {
        alert(`删除失败: ${(err as Error).message}`);
      })
      .finally(() => {
        setDeletingNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(node.id);
          return next;
        });
      });
  }, [deleteNodeAndSave, loadCanvases]);

  // File import handlers
  const handleImportExcel = useCallback(async (file: File) => {
    try {
      setExcelImportLoading(true);
      const { parseExcelFile } = await import('../../utils/excelImport.ts');
      const tables = await parseExcelFile(file);
      const uploaded = await fileApi.uploadAny(file);
      for (const tableData of tables) {
        const node: CanvasNode = {
          id: generateId(),
          type: 'table',
          position: { x: 0, y: 0 },
          data: {
            ...tableData,
            fileUrl: uploaded.url,
            filename: uploaded.filename,
            originalName: uploaded.originalName,
            mimetype: uploaded.mimetype,
            fileSize: file.size,
          },
        };
        addNode(node);
        selectNode(node.id);
      }
    } catch (err) {
      console.error('Excel import failed:', err);
      alert(`Excel 导入失败: ${(err as Error).message}`);
    } finally {
      setExcelImportLoading(false);
    }
  }, [addNode, selectNode]);

  const handleImportMd = useCallback((file: File) => {
    const title = file.name.replace(/\.md$/i, '');
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const htmlContent = marked.parse(content, { async: false }) as string;
        const node = addMarkdownNode({ x: 0, y: 0 }, title, htmlContent);
        selectNode(node.id);
      }
    };
    reader.readAsText(file);
  }, [addMarkdownNode, selectNode]);

  const handleImportHtml = useCallback((file: File) => {
    const title = file.name.replace(/\.html?$/i, '');
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const node = addHtmlNode({ x: 0, y: 0 }, title, content);
        selectNode(node.id);
      }
    };
    reader.readAsText(file);
  }, [addHtmlNode, selectNode]);

  const handleImportPdf = useCallback(async (file: File) => {
    try {
      setPdfConvertLoading(true);
      const { markdown } = await pdfApi.convert(file);
      const html = await marked.parse(markdown);
      const title = file.name.replace(/\.pdf$/i, '');
      const node: CanvasNode = { id: generateId(), type: 'text', position: { x: 0, y: 0 }, data: { type: 'text', title, content: html } };
      addNode(node);
      selectNode(node.id);
    } catch (err) {
      alert(`PDF 转换失败: ${(err as Error).message}`);
    } finally {
      setPdfConvertLoading(false);
    }
  }, [addNode, selectNode]);

  const handleUploadPdf = useCallback(async (file: File) => {
    try {
      setPdfUploadLoading(true);
      const { url, filename } = await fileApi.upload(file);
      const title = file.name.replace(/\.pdf$/i, '');
      const node: CanvasNode = { id: generateId(), type: 'pdf', position: { x: 0, y: 0 }, data: { type: 'pdf', title, url, filename } };
      addNode(node);
      selectNode(node.id);
    } catch (err) {
      alert(`PDF 上传失败: ${(err as Error).message}`);
    } finally {
      setPdfUploadLoading(false);
    }
  }, [addNode, selectNode]);

  if (!currentWorkspaceId) {
    return (
      <div className={`flex flex-col h-full bg-slate-50 shrink-0 items-center justify-center ${headerless ? 'flex-1 min-w-0' : 'border-r border-slate-200'}`} style={headerless ? undefined : { width: 240 }}>
        <p className="text-xs text-slate-400">选择一个文件夹</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-slate-50 shrink-0 ${headerless ? 'flex-1 min-w-0' : 'border-r border-slate-200'}`} style={headerless ? undefined : { width: 240 }}>
      {/* Import toolbar */}
      {!readOnly && <div className="flex items-center gap-0.5 px-1.5 py-0.5 border-b border-slate-200 shrink-0 flex-nowrap overflow-hidden bg-white">
        <IconButton variant="blue" onClick={() => addTextNode({ x: 0, y: 0 })} title="新建文本" className="shrink-0">
          <FilePlus size={13} strokeWidth={2} />
        </IconButton>
        <IconButton variant="emerald" onClick={() => addTableNode({ x: 0, y: 0 })} title="新建表格" className="shrink-0">
          <Table size={13} strokeWidth={2} />
        </IconButton>

        <div className="w-px h-3 bg-slate-200 mx-0.5 shrink-0" />

        <IconButton
          variant="emerald"
          onClick={() => !excelImportLoading && fileInputRef.current?.click()}
          title="导入 Excel 表格"
          className="shrink-0"
          disabled={excelImportLoading}
        >
          {excelImportLoading ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} strokeWidth={2} />}
        </IconButton>
        <IconButton variant="blue" onClick={() => mdInputRef.current?.click()} title="导入 Markdown 文件" className="shrink-0">
          <FileCode2 size={13} strokeWidth={2} />
        </IconButton>
        <IconButton variant="amber" onClick={() => htmlInputRef.current?.click()} title="导入 HTML 网页" className="shrink-0">
          <Globe size={13} strokeWidth={2} />
        </IconButton>

        <div className="w-px h-3 bg-slate-200 mx-0.5 shrink-0" />

        <IconButton
          variant="red"
          onClick={() => !pdfConvertLoading && pdfInputRef.current?.click()}
          title="PDF 转文本 (智能解析模式)"
          className="shrink-0"
          disabled={pdfConvertLoading}
        >
          {pdfConvertLoading ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} strokeWidth={2} />}
        </IconButton>
        <IconButton
          variant="blue"
          onClick={() => !pdfUploadLoading && pdfViewInputRef.current?.click()}
          title="PDF 浏览 (原文阅览模式)"
          className="shrink-0"
          disabled={pdfUploadLoading}
        >
          {pdfUploadLoading ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} strokeWidth={2} />}
        </IconButton>
        <div className="w-px h-3 bg-slate-200 mx-0.5 shrink-0" />
        <div className="inline-flex h-6 shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50" title="按演讲人类型筛选">
          {([
            { key: 'all', label: '全', title: '显示全部附件' },
            { key: 'expert', label: 'E', title: '只看 Expert 附件' },
            { key: 'sellside', label: 'S', title: '只看 Sellside 附件' },
          ] as const).map((item) => {
            const active = sourceFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSourceFilter(item.key)}
                className={`h-full min-w-5 px-1.5 text-[10px] font-semibold transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-slate-400 hover:bg-white hover:text-slate-600'
                }`}
                title={item.title}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <IconButton variant="red" onClick={() => setShowTrash(true)} title="回收站" className="shrink-0">
          <Trash2 size={13} strokeWidth={2} />
        </IconButton>
      </div>}

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImportExcel(f); e.target.value = ''; } }} />
      <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImportPdf(f); e.target.value = ''; } }} />
      <input ref={pdfViewInputRef} type="file" accept=".pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleUploadPdf(f); e.target.value = ''; } }} />
      <input ref={mdInputRef} type="file" accept=".md" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImportMd(f); e.target.value = ''; } }} />
      <input ref={htmlInputRef} type="file" accept=".html,.htm" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImportHtml(f); e.target.value = ''; } }} />

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {!currentCanvasId && (
          <div className="px-3 py-6 text-center text-[11px] text-slate-400">选择画布查看文件</div>
        )}
        {currentCanvasId && canvasFiles.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-slate-400">暂无文件</div>
        )}
        {currentCanvasId && canvasFiles.length > 0 && filteredCanvasFiles.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-slate-400">无匹配的演讲人类型附件</div>
        )}
        {currentCanvasId && filteredCanvasFiles.map((node) => {
          const source = getAttachmentSource(node);
          const sourceBadge = source ? SOURCE_BADGES[source] : null;
          const time = getAttachmentDate(node);
          const title = node.data.title || '未命名附件';
          const deleting = deletingNodeIds.has(node.id);
          const itemTitle = [
            sourceBadge ? sourceBadge.title : '',
            title,
            time?.title || '最后编辑: 未记录',
          ].filter(Boolean).join(' · ');
          return (
            <ListItem
              key={node.id}
              active={selectedNodeId === node.id}
              onClick={() => selectNode(node.id)}
              icon={<FileIcon type={node.data.type} />}
              label={(
                <>
                  {sourceBadge && (
                    <span
                      className={`mr-1 inline-flex shrink-0 rounded border px-1 py-[1px] text-[10px] font-medium leading-3 align-middle ${sourceBadge.className}`}
                      title={sourceBadge.title}
                    >
                      {sourceBadge.label}
                    </span>
                  )}
                  <span className="align-middle">{title}</span>
                </>
              )}
              title={itemTitle}
              className="relative mx-0.5 text-[11px]"
              trailing={!readOnly ? (
                <>
                  {time && (
                    <span className="ml-1 shrink-0 text-[9px] font-normal text-slate-300 transition-opacity group-hover:opacity-0" title={time.title}>
                      {time.label}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`删除附件 ${title}`}
                    disabled={deleting}
                    onPointerDown={stopDeletePressEvent}
                    onMouseDown={stopDeletePressEvent}
                    onClick={(e) => handleDeleteNode(e, node)}
                    className="absolute right-1 top-1/2 z-20 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md border border-red-100 bg-white text-red-500 opacity-0 shadow-sm transition-opacity hover:bg-red-50 disabled:cursor-wait disabled:text-slate-300 group-hover:opacity-100 focus:opacity-100"
                    title={deleting ? '删除中...' : '删除'}
                  >
                    {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  </button>
                </>
              ) : time ? (
                <span className="ml-1 shrink-0 text-[9px] font-normal text-slate-300" title={time.title}>
                  {time.label}
                </span>
              ) : undefined}
            />
          );
        })}
        {currentCanvasId && <div className="mt-1"><TableOfContents /></div>}
      </div>

      {!headerless && (
        <div className="px-2 py-1 border-t border-slate-200 text-[10px] text-slate-400 shrink-0 bg-white">
          {sourceFilter === 'all' ? `${canvasFiles.length} 个文件` : `${filteredCanvasFiles.length}/${canvasFiles.length} 个文件`}
        </div>
      )}
      {!readOnly && <CanvasTrashModal open={showTrash} onClose={() => setShowTrash(false)} />}
    </div>
  );
});
