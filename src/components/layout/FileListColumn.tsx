import { memo, useState, useRef, useCallback, useMemo, useEffect } from 'react';
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
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import type { CanvasNode } from '../../types/index.ts';
import { pdfApi, fileApi } from '../../db/apiClient.ts';
import { marked } from 'marked';
import { TableOfContents } from './TableOfContents.tsx';
import { IconButton, ListItem } from '../ui/index.ts';

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
  const [excelImportLoading, setExcelImportLoading] = useState(false);

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
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-200 shrink-0 flex-nowrap overflow-hidden bg-white">
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
        {currentCanvasId && canvasFiles.map((node) => (
          <ListItem
            key={node.id}
            active={selectedNodeId === node.id}
            onClick={() => selectNode(node.id)}
            icon={<FileIcon type={node.data.type} />}
            label={node.data.title}
            title={node.data.title}
            className="mx-0.5"
            trailing={
              <button
                onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 shrink-0 p-0.5 transition-opacity"
                title="删除"
              >
                <Trash2 size={10} />
              </button>
            }
          />
        ))}
        {currentCanvasId && <div className="mt-2"><TableOfContents /></div>}
      </div>

      {!headerless && (
        <div className="px-2 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0 bg-white">
          {canvasFiles.length} 个文件
        </div>
      )}
    </div>
  );
});
