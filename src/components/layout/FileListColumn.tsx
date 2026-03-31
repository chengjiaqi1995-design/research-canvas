import { memo, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Trash2,
  FileText,
  Table2,
  Upload,
  FileUp,
  Loader2,
  Code,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import type { CanvasNode } from '../../types/index.ts';
import { pdfApi, fileApi } from '../../db/apiClient.ts';
import { marked } from 'marked';

/** Get icon for a file node type */
function FileIcon({ type }: { type: string }) {
  switch (type) {
    case 'table':
      return <Table2 size={11} className="shrink-0 text-green-500" />;
    case 'pdf':
      return <FileText size={11} className="shrink-0 text-red-500" />;
    case 'markdown':
      return (
        <div className="relative shrink-0">
          <FileText size={11} className="text-indigo-500" />
          <div className="absolute -bottom-0.5 -right-0.5 text-[4px] bg-white rounded-full leading-none text-indigo-600 font-bold">M</div>
        </div>
      );
    case 'html':
      return <Code size={11} className="shrink-0 text-orange-500" />;
    default:
      return <FileText size={11} className="shrink-0 text-blue-400" />;
  }
}

interface FileListColumnProps {
  headerless?: boolean;
}

export const FileListColumn = memo(function FileListColumn({ headerless }: FileListColumnProps = {}) {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const loadCanvases = useWorkspaceStore((s) => s.loadCanvases);

  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const { addTextNode, addTableNode, addHtmlNode, addMarkdownNode } = useCanvas();

  // File import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfViewInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const [pdfConvertLoading, setPdfConvertLoading] = useState(false);
  const [pdfUploadLoading, setPdfUploadLoading] = useState(false);

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
      <div className={`flex flex-col h-full bg-slate-50 shrink-0 items-center justify-center ${headerless ? 'flex-1 min-w-0' : 'border-r border-slate-200'}`} style={headerless ? undefined : { width: 220 }}>
        <p className="text-xs text-slate-400">选择一个文件夹</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-slate-50 shrink-0 ${headerless ? 'flex-1 min-w-0' : 'border-r border-slate-200'}`} style={headerless ? undefined : { width: 200 }}>
      {/* Import toolbar */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-slate-100 shrink-0 flex-wrap">
        <button onClick={() => addTextNode({ x: 0, y: 0 })} className="p-0.5 text-slate-400 hover:text-blue-500" title="新建文本">
          <FileText size={10} />
        </button>
        <button onClick={() => addTableNode({ x: 0, y: 0 })} className="p-0.5 text-slate-400 hover:text-green-500" title="新建表格">
          <Table2 size={10} />
        </button>
        <button onClick={() => fileInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-orange-500" title="导入 Excel">
          <Upload size={10} />
        </button>
        <button onClick={() => !pdfConvertLoading && pdfInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-red-500" title="PDF 转文本">
          {pdfConvertLoading ? <Loader2 size={10} className="animate-spin" /> : <FileUp size={10} />}
        </button>
        <button onClick={() => !pdfUploadLoading && pdfViewInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-purple-500" title="PDF 浏览">
          {pdfUploadLoading ? <Loader2 size={10} className="animate-spin" /> : (
            <div className="relative"><FileText size={10} /><div className="absolute -bottom-0.5 -right-0.5 text-[4px] bg-white rounded-full leading-none text-purple-600 font-bold">P</div></div>
          )}
        </button>
        <button onClick={() => mdInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-indigo-500" title="导入 Markdown">
          <div className="relative"><FileText size={10} /><div className="absolute -bottom-0.5 -right-0.5 text-[4px] bg-white rounded-full leading-none text-indigo-600 font-bold">M</div></div>
        </button>
        <button onClick={() => htmlInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-orange-500" title="导入 HTML">
          <Code size={10} />
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

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {!currentCanvasId && (
          <div className="px-3 py-6 text-center text-[11px] text-slate-400">选择画布查看文件</div>
        )}
        {currentCanvasId && canvasFiles.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-slate-400">暂无文件</div>
        )}
        {currentCanvasId && canvasFiles.map((node) => {
          return (
            <div
              key={node.id}
              onClick={() => selectNode(node.id)}
              className={`flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded cursor-pointer group text-[11px]
                ${selectedNodeId === node.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <div className="shrink-0"><FileIcon type={node.data.type} /></div>
              <span className="flex-1 min-w-0 truncate text-[10px]">{node.data.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0 p-0.5 mt-0.5"
                title="删除"
              >
                <Trash2 size={9} />
              </button>
            </div>
          );
        })}
      </div>

      {!headerless && (
        <div className="px-2 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0">
          {canvasFiles.length} 个文件
        </div>
      )}
    </div>
  );
});
