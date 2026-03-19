import { memo, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Plus,
  Trash2,
  FileText,
  Table2,
  Upload,
  FileUp,
  Loader2,
  Code,
  Palette,
  Sparkles,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import type { CanvasNode } from '../../types/index.ts';
import { pdfApi, fileApi } from '../../db/apiClient.ts';
import { marked } from 'marked';

/** Format a timestamp to a short date string */
function formatDate(ts: number | string | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (sameYear) return `${month}-${day}`;
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Get icon for a file node type */
function FileIcon({ type }: { type: string }) {
  switch (type) {
    case 'table':
      return <Table2 size={12} className="shrink-0 text-green-500" />;
    case 'pdf':
      return <FileText size={12} className="shrink-0 text-red-500" />;
    case 'markdown':
      return (
        <div className="relative shrink-0">
          <FileText size={12} className="text-indigo-500" />
          <div className="absolute -bottom-0.5 -right-0.5 text-[5px] bg-white rounded-full leading-none text-indigo-600 font-bold">M</div>
        </div>
      );
    case 'html':
      return <Code size={12} className="shrink-0 text-orange-500" />;
    case 'ai_card':
      return <Sparkles size={12} className="shrink-0 text-violet-500" />;
    default:
      return <FileText size={12} className="shrink-0 text-blue-400" />;
  }
}

export const FileListColumn = memo(function FileListColumn() {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const deleteCanvas = useWorkspaceStore((s) => s.deleteCanvas);
  const renameCanvas = useWorkspaceStore((s) => s.renameCanvas);
  const loadCanvases = useWorkspaceStore((s) => s.loadCanvases);

  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const { addTextNode, addTableNode, addHtmlNode, addMarkdownNode, addAICardNode } = useCanvas();

  // Canvas state
  const [showNewCanvas, setShowNewCanvas] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [canvasRenameValue, setCanvasRenameValue] = useState('');
  const canvasRenameRef = useRef<HTMLInputElement>(null);
  const [expandedCanvases, setExpandedCanvases] = useState<Set<string>>(new Set());

  // File import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfViewInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const [pdfConvertLoading, setPdfConvertLoading] = useState(false);
  const [pdfUploadLoading, setPdfUploadLoading] = useState(false);

  useEffect(() => {
    if (renamingCanvasId && canvasRenameRef.current) {
      canvasRenameRef.current.focus();
      canvasRenameRef.current.select();
    }
  }, [renamingCanvasId]);

  // Auto-expand current canvas
  useEffect(() => {
    if (currentCanvasId) {
      setExpandedCanvases((prev) => new Set(prev).add(currentCanvasId));
    }
  }, [currentCanvasId]);

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

  const canvasFiles = useMemo(() => nodes.filter((n) => !n.isMain), [nodes]);

  const toggleCanvas = (id: string) => {
    setExpandedCanvases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreateCanvas = async () => {
    if (!newCanvasName.trim() || !currentWorkspaceId) return;
    const canvas = await createCanvas(currentWorkspaceId, newCanvasName.trim());
    setNewCanvasName('');
    setShowNewCanvas(false);
    setCurrentCanvas(canvas.id);
  };

  // File import handlers
  const handleImportExcel = useCallback(async (file: File) => {
    try {
      const { parseExcelFile } = await import('../../utils/excelImport.ts');
      const tables = await parseExcelFile(file);
      for (const tableData of tables) {
        const node: CanvasNode = { id: generateId(), type: 'table', position: { x: 0, y: 0 }, data: tableData };
        addNode(node);
        selectNode(node.id);
      }
    } catch (err) {
      console.error('Excel import failed:', err);
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
      <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200 shrink-0 items-center justify-center" style={{ width: 220 }}>
        <p className="text-xs text-slate-400">选择一个文件夹</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200 shrink-0" style={{ width: 220 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-slate-200 shrink-0">
        <span className="text-xs font-semibold text-slate-700 truncate">附件</span>
        <button onClick={() => setShowNewCanvas(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="新建画布">
          <Plus size={14} />
        </button>
      </div>

      {/* New canvas input */}
      {showNewCanvas && (
        <div className="px-2 py-1.5 border-b border-slate-100 shrink-0">
          <input
            autoFocus
            value={newCanvasName}
            onChange={(e) => setNewCanvasName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateCanvas();
              if (e.key === 'Escape') setShowNewCanvas(false);
            }}
            placeholder="画布名称..."
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-400"
          />
        </div>
      )}

      {/* Import toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-100 shrink-0 flex-wrap">
        <button onClick={() => addTextNode({ x: 0, y: 0 })} className="p-1 text-slate-400 hover:text-blue-500" title="新建文本">
          <FileText size={12} />
        </button>
        <button onClick={() => addTableNode({ x: 0, y: 0 })} className="p-1 text-slate-400 hover:text-green-500" title="新建表格">
          <Table2 size={12} />
        </button>
        <button onClick={() => fileInputRef.current?.click()} className="p-1 text-slate-400 hover:text-orange-500" title="导入 Excel">
          <Upload size={12} />
        </button>
        <button onClick={() => !pdfConvertLoading && pdfInputRef.current?.click()} className="p-1 text-slate-400 hover:text-red-500" title="PDF 转文本">
          {pdfConvertLoading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
        </button>
        <button onClick={() => !pdfUploadLoading && pdfViewInputRef.current?.click()} className="p-1 text-slate-400 hover:text-purple-500" title="PDF 浏览">
          {pdfUploadLoading ? <Loader2 size={12} className="animate-spin" /> : (
            <div className="relative"><FileText size={12} /><div className="absolute -bottom-0.5 -right-0.5 text-[5px] bg-white rounded-full leading-none text-purple-600 font-bold">P</div></div>
          )}
        </button>
        <button onClick={() => mdInputRef.current?.click()} className="p-1 text-slate-400 hover:text-indigo-500" title="导入 Markdown">
          <div className="relative"><FileText size={12} /><div className="absolute -bottom-0.5 -right-0.5 text-[5px] bg-white rounded-full leading-none text-indigo-600 font-bold">M</div></div>
        </button>
        <button onClick={() => htmlInputRef.current?.click()} className="p-1 text-slate-400 hover:text-orange-500" title="导入 HTML">
          <Code size={12} />
        </button>
        <button onClick={() => { const n = addAICardNode({ x: 0, y: 0 }); selectNode(n.id); }} className="p-1 text-slate-400 hover:text-violet-500" title="AI 卡片">
          <Sparkles size={12} />
        </button>
      </div>

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

      {/* Canvas + file list */}
      <div className="flex-1 overflow-y-auto py-1">
        {canvases.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-slate-400">暂无画布</div>
        )}

        {canvases.map((canvas) => {
          const isCurrent = currentCanvasId === canvas.id;
          const isExpanded = expandedCanvases.has(canvas.id);
          const isRenaming = renamingCanvasId === canvas.id;
          const filesInCanvas = isCurrent ? canvasFiles : [];

          return (
            <div key={canvas.id}>
              {/* Canvas row */}
              <div
                className={`flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer group text-xs ${isCurrent ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => {
                  setCurrentCanvas(canvas.id);
                  toggleCanvas(canvas.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenamingCanvasId(canvas.id);
                  setCanvasRenameValue(canvas.title);
                }}
              >
                {isExpanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
                <Palette size={12} className="shrink-0 text-violet-500" />

                {isRenaming ? (
                  <input
                    ref={canvasRenameRef}
                    value={canvasRenameValue}
                    onChange={(e) => setCanvasRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { if (canvasRenameValue.trim()) renameCanvas(canvas.id, canvasRenameValue.trim()); setRenamingCanvasId(null); }
                      if (e.key === 'Escape') setRenamingCanvasId(null);
                    }}
                    onBlur={() => { if (canvasRenameValue.trim()) renameCanvas(canvas.id, canvasRenameValue.trim()); setRenamingCanvasId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-xs px-1 border border-blue-400 rounded outline-none bg-white min-w-0"
                  />
                ) : (
                  <span className="flex-1 truncate">{canvas.title}</span>
                )}

                <span className="text-[10px] text-slate-400 shrink-0">{formatDate(canvas.updatedAt)}</span>

                {!isRenaming && (
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm(`删除画布「${canvas.title}」？`)) deleteCanvas(canvas.id); }}
                    className="hidden group-hover:block p-0.5 rounded hover:bg-red-100 text-red-400 shrink-0"
                    title="删除"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>

              {/* Files in canvas */}
              {isExpanded && isCurrent && filesInCanvas.length > 0 && (
                <div className="ml-5">
                  {filesInCanvas.map((node) => (
                    <div
                      key={node.id}
                      onClick={() => selectNode(node.id)}
                      className={`flex items-center gap-1.5 px-2 py-1 mx-1 rounded cursor-pointer group text-xs
                        ${selectedNodeId === node.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      <FileIcon type={node.data.type} />
                      <span className="flex-1 truncate">{node.data.title}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{formatDate(canvas.updatedAt)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0 p-0.5"
                        title="删除"
                      >
                        <Trash2 size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-2 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0">
        {canvases.length} 个画布 · {canvasFiles.length} 个文件
      </div>
    </div>
  );
});
