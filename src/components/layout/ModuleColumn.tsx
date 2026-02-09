import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, X, FileText, Table2, Upload, Trash2, FileUp, Loader2, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import type { ModuleConfig, CanvasNode } from '../../types/index.ts';
import { pdfApi, fileApi } from '../../db/apiClient.ts';
import { marked } from 'marked';

import { EditorRoot, EditorContent } from 'novel';

/** Inline text editor for a module's main text node */
function ModuleEditor({ nodeId, content }: { nodeId: string; content: string }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <EditorRoot>
      <EditorContent
        extensions={[]}
        immediatelyRender={false}
        onCreate={({ editor }) => {
          if (content) {
            editor.commands.setContent(content);
          }
        }}
        onUpdate={({ editor }) => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            const html = editor.getHTML();
            updateNodeData(nodeId, { content: html });
          }, 500);
        }}
        editorProps={{
          attributes: {
            class: 'prose prose-sm max-w-none px-3 py-2 focus:outline-none text-sm leading-relaxed',
          },
        }}
      />
    </EditorRoot>
  );
}

/** Compact file list sidebar inside a module */
function ModuleFileList({
  moduleId,
  nodes,
  selectedNodeId,
}: {
  moduleId: string;
  nodes: CanvasNode[];
  selectedNodeId: string | null;
}) {
  const selectNode = useCanvasStore((s) => s.selectNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const { addTextNode, addTableNode } = useCanvas();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pdfViewInputRef = useRef<HTMLInputElement>(null);
  const [pdfConvertLoading, setPdfConvertLoading] = useState(false);
  const [pdfUploadLoading, setPdfUploadLoading] = useState(false);

  const moduleFiles = useMemo(
    () => nodes.filter((n) => n.module === moduleId && !n.isMain),
    [nodes, moduleId]
  );

  const handleImportExcel = useCallback(
    async (file: File) => {
      try {
        const { parseExcelFile } = await import('../../utils/excelImport.ts');
        const tables = await parseExcelFile(file);
        for (const tableData of tables) {
          const node: CanvasNode = {
            id: generateId(),
            type: 'table',
            position: { x: 0, y: 0 },
            data: tableData,
            module: moduleId,
          };
          addNode(node);
          selectNode(node.id);
        }
      } catch (err) {
        console.error('Excel import failed:', err);
      }
    },
    [moduleId, addNode, selectNode]
  );

  const handleAddText = useCallback(() => {
    const node = addTextNode({ x: 0, y: 0 }, moduleId);
    selectNode(node.id);
  }, [addTextNode, moduleId, selectNode]);

  const handleAddTable = useCallback(() => {
    const node = addTableNode({ x: 0, y: 0 }, moduleId);
    selectNode(node.id);
  }, [addTableNode, moduleId, selectNode]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation();
      removeNode(nodeId);
    },
    [removeNode]
  );

  const handleImportPdf = useCallback(
    async (file: File) => {
      try {
        setPdfConvertLoading(true);
        const { markdown } = await pdfApi.convert(file);
        // Convert Markdown to HTML so BlockNote can parse it correctly (tables, headers, etc.)
        const html = await marked.parse(markdown);

        const title = file.name.replace(/\.pdf$/i, '');
        const node: CanvasNode = {
          id: generateId(),
          type: 'text',
          position: { x: 0, y: 0 },
          data: { type: 'text', title, content: html },
          module: moduleId,
        };
        addNode(node);
        selectNode(node.id);
      } catch (err) {
        console.error('PDF import failed:', err);
        alert(`PDF 转换失败: ${(err as Error).message}`);
      } finally {
        setPdfConvertLoading(false);
      }
    },
    [moduleId, addNode, selectNode]
  );

  const handleUploadPdf = useCallback(
    async (file: File) => {
      try {
        setPdfUploadLoading(true);
        const { url, filename } = await fileApi.upload(file);

        const title = file.name.replace(/\.pdf$/i, '');
        const node: CanvasNode = {
          id: generateId(),
          type: 'pdf',
          position: { x: 0, y: 0 },
          data: { type: 'pdf', title, url, filename },
          module: moduleId,
        };
        addNode(node);
        selectNode(node.id);
      } catch (err) {
        console.error('PDF upload failed:', err);
        alert(`PDF 上传失败: ${(err as Error).message}`);
      } finally {
        setPdfUploadLoading(false);
      }
    },
    [moduleId, addNode, selectNode]
  );

  return (
    <div className="flex flex-col h-full border-l border-slate-200 bg-slate-50/50">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleImportExcel(file);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleImportPdf(file);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={pdfViewInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadPdf(file);
            e.target.value = '';
          }
        }}
      />

      {/* Buttons moved to top */}
      <div className="px-1.5 py-1 border-b border-slate-200 bg-white shrink-0 flex items-center gap-1">
        <button
          onClick={handleAddText}
          className="p-1 text-slate-400 hover:text-blue-500 transition-colors"
          title="新建文本"
        >
          <FileText size={11} />
        </button>
        <button
          onClick={handleAddTable}
          className="p-1 text-slate-400 hover:text-green-500 transition-colors"
          title="新建表格"
        >
          <Table2 size={11} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1 text-slate-400 hover:text-orange-500 transition-colors"
          title="导入 Excel"
        >
          <Upload size={11} />
        </button>
        <button
          onClick={() => !pdfConvertLoading && pdfInputRef.current?.click()}
          disabled={pdfConvertLoading}
          className={`p-1 transition-colors ${pdfConvertLoading ? 'text-blue-400 animate-pulse' : 'text-slate-400 hover:text-red-500'}`}
          title={pdfConvertLoading ? '处理中...' : '导入 PDF (转文本)'}
        >
          {pdfConvertLoading ? <Loader2 size={11} className="animate-spin" /> : <FileUp size={11} />}
        </button>
        <button
          onClick={() => !pdfUploadLoading && pdfViewInputRef.current?.click()}
          disabled={pdfUploadLoading}
          className={`p-1 transition-colors ${pdfUploadLoading ? 'text-purple-400 animate-pulse' : 'text-slate-400 hover:text-purple-500'}`}
          title={pdfUploadLoading ? '上传中...' : '导入 PDF (浏览)'}
        >
          {pdfUploadLoading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <div className="relative">
              <FileText size={11} />
              <div className="absolute -bottom-0.5 -right-0.5 text-[6px] bg-white rounded-full leading-none text-purple-600 font-bold">P</div>
            </div>
          )}
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {moduleFiles.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[10px] text-slate-300 px-2 text-center">
            暂无文件
          </div>
        ) : (
          moduleFiles.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isTable = node.data.type === 'table';
            const isPdf = node.data.type === 'pdf';
            return (
              <div
                key={node.id}
                onClick={() => selectNode(node.id)}
                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer border-b border-slate-100 transition-colors group
                  ${isSelected ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {isTable ? (
                  <Table2 size={10} className="shrink-0 text-green-500" />
                ) : isPdf ? (
                  <FileText size={10} className="shrink-0 text-purple-500" />
                ) : (
                  <FileText size={10} className="shrink-0 text-blue-400" />
                )}
                <span className="flex-1 truncate">{node.data.title}</span>
                <button
                  onClick={(e) => handleDelete(e, node.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0 p-0.5 transition-opacity"
                  title="删除"
                >
                  <Trash2 size={9} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Vertical resize handle between modules */
function VerticalResizeHandle({ onDrag }: { onDrag: (deltaY: number) => void }) {
  const startYRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startYRef.current = e.clientY;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startYRef.current;
        startYRef.current = ev.clientY;
        onDrag(delta);
      };
      const handleMouseUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [onDrag]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="h-1 bg-slate-200 hover:bg-blue-400 cursor-row-resize shrink-0 transition-colors relative"
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-0.5 w-8 rounded bg-slate-400 opacity-40" />
    </div>
  );
}

/** Single collapsible module section with inline file list */
function ModuleItem({
  module,
  mainNode,
  nodes,
  selectedNodeId,
  heightRatio,
  fileListCollapsed,
  onToggleFileList,
}: {
  module: ModuleConfig;
  mainNode: CanvasNode | null;
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  heightRatio: number;
  fileListCollapsed: boolean;
  onToggleFileList: () => void;
}) {
  const toggleModuleCollapse = useCanvasStore((s) => s.toggleModuleCollapse);
  const renameModule = useCanvasStore((s) => s.renameModule);
  const removeModule = useCanvasStore((s) => s.removeModule);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(module.name);

  const handleSaveName = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== module.name) {
      renameModule(module.id, trimmed);
    }
    setIsEditing(false);
  }, [editName, module.id, module.name, renameModule]);

  const handleDelete = useCallback(() => {
    if (confirm(`确定删除模块「${module.name}」及其所有内容？`)) {
      removeModule(module.id);
    }
  }, [module.id, module.name, removeModule]);

  const collapsed = module.collapsed ?? false;

  return (
    <div
      className="border-b border-slate-200 flex flex-col overflow-hidden"
      style={collapsed ? {} : { flex: heightRatio }}
    >
      {/* Header bar */}
      <div className="flex items-center gap-1 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors shrink-0">
        <button
          onClick={() => toggleModuleCollapse(module.id)}
          className="text-slate-400 hover:text-slate-600 shrink-0"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>

        {isEditing ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveName();
              if (e.key === 'Escape') {
                setEditName(module.name);
                setIsEditing(false);
              }
            }}
            onBlur={handleSaveName}
            className="flex-1 text-sm font-semibold border-b border-blue-400 outline-none bg-transparent"
          />
        ) : (
          <span
            className="flex-1 text-sm font-semibold text-slate-700 cursor-pointer truncate"
            onDoubleClick={() => {
              setEditName(module.name);
              setIsEditing(true);
            }}
          >
            {module.name}
          </span>
        )}

        {/* File list toggle */}
        {!collapsed && (
          <button
            onClick={onToggleFileList}
            className="text-slate-300 hover:text-blue-500 shrink-0 p-0.5"
            title={fileListCollapsed ? '展开文件列表' : '折叠文件列表'}
          >
            {fileListCollapsed ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
          </button>
        )}

        <button
          onClick={handleDelete}
          className="text-slate-300 hover:text-red-400 shrink-0 p-0.5"
          title="删除模块"
        >
          <X size={13} />
        </button>
      </div>

      {/* Content: editor (left) + file list (right) */}
      {!collapsed && (
        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 80 }}>
          {/* Editor area — always shows mainNode */}
          <div className="flex-1 overflow-y-auto min-w-0">
            {mainNode && mainNode.data.type === 'text' ? (
              <ModuleEditor
                key={mainNode.id}
                nodeId={mainNode.id}
                content={mainNode.data.content}
              />
            ) : (
              <div className="flex items-center justify-center h-20 text-xs text-slate-300">
                加载中...
              </div>
            )}
          </div>

          {/* File list sidebar (collapsible) */}
          {!fileListCollapsed && (
            <div className="w-[130px] shrink-0 overflow-hidden">
              <ModuleFileList
                moduleId={module.id}
                nodes={nodes}
                selectedNodeId={selectedNodeId}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ModuleColumn = memo(function ModuleColumn() {
  const modules = useCanvasStore((s) => s.modules);
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const addModule = useCanvasStore((s) => s.addModule);

  // Height ratios for each module (keyed by module id)
  const [heightRatios, setHeightRatios] = useState<Record<string, number>>({});
  // File list collapsed state per module
  const [fileListCollapsed, setFileListCollapsed] = useState<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Find main node per module
  const mainNodeMap = useMemo(() => {
    const map: Record<string, CanvasNode | null> = {};
    for (const mod of modules) {
      map[mod.id] = nodes.find(
        (n) => n.module === mod.id && n.isMain && n.data.type === 'text'
      ) ?? null;
    }
    return map;
  }, [modules, nodes]);

  const sortedModules = useMemo(
    () => [...modules].sort((a, b) => a.order - b.order),
    [modules]
  );

  // Get expanded (non-collapsed) modules for ratio calculation
  const expandedModules = useMemo(
    () => sortedModules.filter((m) => !(m.collapsed ?? false)),
    [sortedModules]
  );

  // Get effective ratio for a module (default = 1 = equal share)
  const getRatio = useCallback(
    (modId: string) => heightRatios[modId] ?? 1,
    [heightRatios]
  );

  // Handle drag resize between two adjacent expanded modules
  const handleResizeBetween = useCallback(
    (topModId: string, bottomModId: string, deltaY: number) => {
      if (!containerRef.current) return;
      const totalH = containerRef.current.getBoundingClientRect().height;
      // Calculate total ratio of expanded modules
      const totalRatio = expandedModules.reduce((sum, m) => sum + (heightRatios[m.id] ?? 1), 0);
      const deltaRatio = (deltaY / totalH) * totalRatio;

      setHeightRatios((prev) => {
        const topR = (prev[topModId] ?? 1) + deltaRatio;
        const bottomR = (prev[bottomModId] ?? 1) - deltaRatio;
        // Minimum ratio of 0.2 to prevent collapsing to zero
        if (topR < 0.2 || bottomR < 0.2) return prev;
        return { ...prev, [topModId]: topR, [bottomModId]: bottomR };
      });
    },
    [expandedModules, heightRatios]
  );

  const toggleFileList = useCallback((modId: string) => {
    setFileListCollapsed((prev) => ({ ...prev, [modId]: !prev[modId] }));
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        {sortedModules.map((mod) => {
          const collapsed = mod.collapsed ?? false;
          // Find previous expanded module for resize handle
          const expandedIdx = expandedModules.indexOf(mod);
          const showResizeHandle = !collapsed && expandedIdx > 0;
          const prevExpandedMod = showResizeHandle ? expandedModules[expandedIdx - 1] : null;

          return (
            <React.Fragment key={mod.id}>
              {showResizeHandle && prevExpandedMod && (
                <VerticalResizeHandle
                  onDrag={(dy) => handleResizeBetween(prevExpandedMod.id, mod.id, dy)}
                />
              )}
              <ModuleItem
                module={mod}
                mainNode={mainNodeMap[mod.id]}
                nodes={nodes}
                selectedNodeId={selectedNodeId}
                heightRatio={getRatio(mod.id)}
                fileListCollapsed={fileListCollapsed[mod.id] ?? false}
                onToggleFileList={() => toggleFileList(mod.id)}
              />
            </React.Fragment>
          );
        })}
      </div>

      <div className="px-3 py-2 border-t border-slate-200 bg-white shrink-0">
        <button
          onClick={() => addModule('新模块')}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition-colors"
        >
          <Plus size={13} />
          添加模块
        </button>
      </div>
    </div>
  );
});
