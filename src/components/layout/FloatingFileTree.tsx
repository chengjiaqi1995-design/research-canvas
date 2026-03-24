import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  X,
  FolderOpen,
  Folder,
  FileText,
  Table2,
  Upload,
  FileUp,
  Loader2,
  Code,
  Palette,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import type { CanvasNode } from '../../types/index.ts';
import { pdfApi, fileApi } from '../../db/apiClient.ts';
import { marked } from 'marked';

interface FloatingFileTreeProps {
  open: boolean;
  onClose: () => void;
}

/** Format a timestamp to a short date string */
function formatDate(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (sameYear) return `${month}-${day}`;
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Get icon for a file node */
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
    default:
      return <FileText size={12} className="shrink-0 text-blue-400" />;
  }
}

export const FloatingFileTree = memo(function FloatingFileTree({ open, onClose }: FloatingFileTreeProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const deleteCanvas = useWorkspaceStore((s) => s.deleteCanvas);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const renameCanvas = useWorkspaceStore((s) => s.renameCanvas);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const loadCanvases = useWorkspaceStore((s) => s.loadCanvases);

  // Canvas store — file nodes
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const { addTextNode, addTableNode, addHtmlNode, addMarkdownNode } = useCanvas();

  // UI state
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [expandedCanvases, setExpandedCanvases] = useState<Set<string>>(new Set());
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showNewCanvas, setShowNewCanvas] = useState<string | null>(null);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [canvasRenameValue, setCanvasRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // File import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfViewInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const htmlInputRef = useRef<HTMLInputElement>(null);
  const [pdfConvertLoading, setPdfConvertLoading] = useState(false);
  const [pdfUploadLoading, setPdfUploadLoading] = useState(false);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const canvasRenameRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Draggable state
  const [position, setPosition] = useState({ x: 16, y: 56 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  // Auto-expand current workspace
  useEffect(() => {
    if (currentWorkspaceId) {
      setExpandedWorkspaces((prev) => new Set(prev).add(currentWorkspaceId));
    }
  }, [currentWorkspaceId]);

  // Auto-expand current canvas
  useEffect(() => {
    if (currentCanvasId) {
      setExpandedCanvases((prev) => new Set(prev).add(currentCanvasId));
    }
  }, [currentCanvasId]);

  useEffect(() => {
    if (renamingWorkspaceId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingWorkspaceId]);

  useEffect(() => {
    if (renamingCanvasId && canvasRenameRef.current) {
      canvasRenameRef.current.focus();
      canvasRenameRef.current.select();
    }
  }, [renamingCanvasId]);

  // Refresh on tab visible
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadWorkspaces();
        const wsId = useWorkspaceStore.getState().currentWorkspaceId;
        if (wsId) loadCanvases(wsId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadWorkspaces, loadCanvases]);

  // Files in current canvas (non-main nodes)
  const canvasFiles = useMemo(
    () => nodes.filter((n) => !n.isMain),
    [nodes]
  );

  // Canvas updatedAt for date display
  const currentCanvas = canvases.find((c) => c.id === currentCanvasId);

  // Filtered workspaces
  const filteredWorkspaces = useMemo(() => {
    if (!searchQuery.trim()) return workspaces;
    const q = searchQuery.toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(q));
  }, [workspaces, searchQuery]);

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCurrentWorkspace(id);
  };

  const toggleCanvas = (canvasId: string) => {
    setExpandedCanvases((prev) => {
      const next = new Set(prev);
      if (next.has(canvasId)) next.delete(canvasId);
      else next.add(canvasId);
      return next;
    });
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    const ws = await createWorkspace(newWorkspaceName.trim(), '📁');
    setNewWorkspaceName('');
    setShowNewWorkspace(false);
    setExpandedWorkspaces((prev) => new Set(prev).add(ws.id));
    setCurrentWorkspace(ws.id);
  };

  const handleCreateCanvas = async (workspaceId: string) => {
    if (!newCanvasName.trim()) return;
    const canvas = await createCanvas(workspaceId, newCanvasName.trim());
    setNewCanvasName('');
    setShowNewCanvas(null);
    setCurrentCanvas(canvas.id);
  };

  // File import handlers
  const handleImportExcel = useCallback(
    async (file: File) => {
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
    }, [addNode, selectNode]
  );

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

  // Drag to move panel
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPosX: position.x, startPosY: position.y };
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPosition({ x: dragRef.current.startPosX + dx, y: dragRef.current.startPosY + dy });
    };
    const handleUp = () => {
      dragRef.current.dragging = false;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [position]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: 320,
        maxHeight: 'calc(100vh - 80px)',
      }}
    >
      {/* Header — draggable */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-xl cursor-move shrink-0"
        onMouseDown={handleDragStart}
      >
        <span className="text-xs font-semibold text-slate-700 select-none">文件管理</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowNewWorkspace(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="新建文件夹">
            <Plus size={14} />
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="关闭">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 border-b border-slate-100 shrink-0">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索..."
          className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-slate-50"
        />
      </div>

      {/* New workspace input */}
      {showNewWorkspace && (
        <div className="px-3 py-2 border-b border-slate-100 shrink-0">
          <input
            autoFocus
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateWorkspace();
              if (e.key === 'Escape') setShowNewWorkspace(false);
            }}
            placeholder="文件夹名称..."
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-400"
          />
        </div>
      )}

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

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1" style={{ minHeight: 100 }}>
        {filteredWorkspaces.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-slate-400">
            {searchQuery ? '无匹配结果' : '暂无文件夹，点击 + 创建'}
          </div>
        )}

        {filteredWorkspaces.map((ws) => {
          const isExpanded = expandedWorkspaces.has(ws.id);
          const isActive = currentWorkspaceId === ws.id;
          const isRenaming = renamingWorkspaceId === ws.id;

          return (
            <div key={ws.id}>
              {/* Workspace row */}
              <div
                className={`flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer group text-xs ${isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'}`}
                onClick={() => toggleWorkspace(ws.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenamingWorkspaceId(ws.id);
                  setRenameValue(ws.name);
                }}
              >
                {isExpanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                {isExpanded ? <FolderOpen size={12} className="shrink-0 text-amber-500" /> : <Folder size={12} className="shrink-0 text-amber-500" />}

                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { if (renameValue.trim()) renameWorkspace(ws.id, renameValue.trim()); setRenamingWorkspaceId(null); }
                      if (e.key === 'Escape') setRenamingWorkspaceId(null);
                    }}
                    onBlur={() => { if (renameValue.trim()) renameWorkspace(ws.id, renameValue.trim()); setRenamingWorkspaceId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-xs px-1 border border-blue-400 rounded outline-none bg-white min-w-0"
                  />
                ) : (
                  <span className="flex-1 truncate">{ws.name}</span>
                )}

                {!isRenaming && (
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button onClick={(e) => { e.stopPropagation(); setShowNewCanvas(ws.id); }} className="p-0.5 rounded hover:bg-slate-200" title="新建画布">
                      <Plus size={11} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); if (confirm(`删除文件夹「${ws.name}」？`)) deleteWorkspace(ws.id); }}
                      className="p-0.5 rounded hover:bg-red-100 text-red-400" title="删除">
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Canvas list under workspace */}
              {isExpanded && (
                <div className="ml-4">
                  {/* New canvas input */}
                  {showNewCanvas === ws.id && (
                    <div className="px-2 py-1">
                      <input
                        autoFocus
                        value={newCanvasName}
                        onChange={(e) => setNewCanvasName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateCanvas(ws.id);
                          if (e.key === 'Escape') setShowNewCanvas(null);
                        }}
                        placeholder="画布名称..."
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-400"
                      />
                    </div>
                  )}

                  {isActive && canvases.map((canvas) => {
                    const isCanvasExpanded = expandedCanvases.has(canvas.id);
                    const isCurrentCanvas = currentCanvasId === canvas.id;
                    const isRenamingCanvas = renamingCanvasId === canvas.id;
                    const filesInCanvas = isCurrentCanvas ? canvasFiles : [];

                    return (
                      <div key={canvas.id}>
                        {/* Canvas row */}
                        <div
                          className={`flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer group text-xs ${isCurrentCanvas ? 'bg-blue-100 text-blue-800' : 'text-slate-600 hover:bg-slate-100'}`}
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
                          {isCanvasExpanded ? <ChevronDown size={10} className="shrink-0" /> : <ChevronRight size={10} className="shrink-0" />}
                          <Palette size={11} className="shrink-0 text-violet-500" />

                          {isRenamingCanvas ? (
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

                          {!isRenamingCanvas && (
                            <button onClick={(e) => { e.stopPropagation(); if (confirm(`删除画布「${canvas.title}」？`)) deleteCanvas(canvas.id); }}
                              className="hidden group-hover:block p-0.5 rounded hover:bg-red-100 text-red-400" title="删除">
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>

                        {/* Files in canvas */}
                        {isCanvasExpanded && isCurrentCanvas && (
                          <div className="ml-4">
                            {/* Import buttons */}
                            <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100">
                              <button onClick={() => { addTextNode({ x: 0, y: 0 }); }} className="p-0.5 text-slate-400 hover:text-blue-500" title="新建文本">
                                <FileText size={10} />
                              </button>
                              <button onClick={() => { addTableNode({ x: 0, y: 0 }); }} className="p-0.5 text-slate-400 hover:text-green-500" title="新建表格">
                                <Table2 size={10} />
                              </button>
                              <button onClick={() => fileInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-orange-500" title="导入 Excel">
                                <Upload size={10} />
                              </button>
                              <button onClick={() => !pdfConvertLoading && pdfInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-red-500" title="导入 PDF (转文本)">
                                {pdfConvertLoading ? <Loader2 size={10} className="animate-spin" /> : <FileUp size={10} />}
                              </button>
                              <button onClick={() => !pdfUploadLoading && pdfViewInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-purple-500" title="导入 PDF (浏览)">
                                {pdfUploadLoading ? <Loader2 size={10} className="animate-spin" /> : (
                                  <div className="relative"><FileText size={10} /><div className="absolute -bottom-0.5 -right-0.5 text-[5px] bg-white rounded-full leading-none text-purple-600 font-bold">P</div></div>
                                )}
                              </button>
                              <button onClick={() => mdInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-indigo-500" title="导入 Markdown">
                                <div className="relative"><FileText size={10} /><div className="absolute -bottom-0.5 -right-0.5 text-[5px] bg-white rounded-full leading-none text-indigo-600 font-bold">M</div></div>
                              </button>
                              <button onClick={() => htmlInputRef.current?.click()} className="p-0.5 text-slate-400 hover:text-orange-500" title="导入 HTML">
                                <Code size={10} />
                              </button>
                            </div>

                            {/* File list */}
                            {filesInCanvas.length === 0 ? (
                              <div className="px-3 py-2 text-[10px] text-slate-300">暂无文件</div>
                            ) : (
                              filesInCanvas.map((node) => (
                                <div
                                  key={node.id}
                                  onClick={() => selectNode(node.id)}
                                  className={`flex items-center gap-1.5 px-2 py-1 mx-1 rounded cursor-pointer group text-xs
                                    ${selectedNodeId === node.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
                                >
                                  <FileIcon type={node.data.type} />
                                  <span className="flex-1 truncate">{node.data.title}</span>
                                  <span className="text-[10px] text-slate-400 shrink-0">{formatDate(currentCanvas?.updatedAt)}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0 p-0.5"
                                    title="删除"
                                  >
                                    <Trash2 size={9} />
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {isActive && canvases.length === 0 && (
                    <div className="px-3 py-2 text-xs text-slate-400">暂无画布</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-2 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0">
        {workspaces.length}
      </div>
    </div>
  );
});
