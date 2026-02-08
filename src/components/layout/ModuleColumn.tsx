import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, X, FileText, Table2, Upload, Trash2, FileUp, Loader2 } from 'lucide-react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import type { ModuleConfig, CanvasNode } from '../../types/index.ts';
import { pdfApi, fileApi } from '../../db/apiClient.ts';
import { marked } from 'marked';
import { PdfNode } from '../nodes/PdfNode.tsx';

/** Inline BlockNote editor for a module's main text node */
function ModuleEditor({ nodeId, content }: { nodeId: string; content: string }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  const editor = useCreateBlockNote({
    initialContent: undefined,
    uploadFile: async (file: File) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    },
  });

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (content) {
      try {
        const blocks = editor.tryParseHTMLToBlocks(content);
        if (blocks.length > 0) {
          editor.replaceBlocks(editor.document, blocks);
        }
      } catch {
        // leave default
      }
    }
  }, [editor, content]);

  const handleChange = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const html = await editor.blocksToHTMLLossy();
      updateNodeData(nodeId, { content: html });
    }, 500);
  }, [editor, nodeId, updateNodeData]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return (
    <BlockNoteView
      editor={editor}
      onChange={handleChange}
      theme="light"
    />
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
  const [pdfConverting, setPdfConverting] = useState(false);

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
        }
        if (tables.length > 0) {
          const allNodes = useCanvasStore.getState().nodes;
          const lastId = allNodes[allNodes.length - 1]?.id;
          if (lastId) selectNode(lastId);
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
        setPdfConverting(true);
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
        setPdfConverting(false);
      }
    },
    [moduleId, addNode, selectNode]
  );

  const handleUploadPdf = useCallback(
    async (file: File) => {
      try {
        setPdfConverting(true);
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
        setPdfConverting(false);
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
          onClick={() => !pdfConverting && pdfInputRef.current?.click()}
          disabled={pdfConverting}
          className={`p-1 transition-colors ${pdfConverting ? 'text-blue-400 animate-pulse' : 'text-slate-400 hover:text-red-500'}`}
          title={pdfConverting ? '处理中...' : '导入 PDF (转文本)'}
        >
          {pdfConverting ? <Loader2 size={11} className="animate-spin" /> : <FileUp size={11} />}
        </button>
        <button
          onClick={() => !pdfConverting && pdfViewInputRef.current?.click()}
          className="p-1 text-slate-400 hover:text-purple-500 transition-colors"
          title="导入 PDF (浏览)"
        >
          <div className="relative">
            <FileText size={11} />
            <div className="absolute -bottom-0.5 -right-0.5 text-[6px] bg-white rounded-full leading-none text-purple-600 font-bold">P</div>
          </div>
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
            return (
              <div
                key={node.id}
                onClick={() => selectNode(node.id)}
                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer border-b border-slate-100 transition-colors group
                  ${isSelected ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {isTable ? (
                  <Table2 size={10} className="shrink-0 text-green-500" />
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

/** Single collapsible module section with inline file list */
function ModuleItem({
  module,
  mainNode,
  nodes,
  selectedNodeId,
  totalModules,
}: {
  module: ModuleConfig;
  mainNode: CanvasNode | null;
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  totalModules: number;
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

  const selectNode = useCanvasStore((s) => s.selectNode);

  // Detect if a PDF node in this module is selected
  const selectedPdfNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = nodes.find(n => n.id === selectedNodeId);
    if (node && node.module === module.id && node.data.type === 'pdf') return node;
    return null;
  }, [selectedNodeId, nodes, module.id]);

  const collapsed = module.collapsed ?? false;

  return (
    <div className="border-b border-slate-200 relative" style={totalModules === 1 ? { display: 'flex', flexDirection: 'column', flex: 1 } : undefined}>
      {/* Header bar */}
      <div className="flex items-center gap-1 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
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
        <div className="flex" style={{ minHeight: 100, ...(totalModules > 1 ? { maxHeight: 400 } : { flex: 1 }) }}>
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

          {/* File list sidebar */}
          <div className="w-[130px] shrink-0 overflow-hidden">
            <ModuleFileList
              moduleId={module.id}
              nodes={nodes}
              selectedNodeId={selectedNodeId}
            />
          </div>
        </div>
      )}

      {/* PDF overlay — shown when a PDF file is selected */}
      {selectedPdfNode && selectedPdfNode.data.type === 'pdf' && (
        <div className="absolute inset-0 z-50 bg-white flex flex-col border border-slate-200 shadow-lg rounded">
          <PdfNode
            data={selectedPdfNode.data}
            onClose={() => selectNode(null)}
          />
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {sortedModules.map((mod) => (
          <ModuleItem
            key={mod.id}
            module={mod}
            mainNode={mainNodeMap[mod.id]}
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            totalModules={sortedModules.length}
          />
        ))}
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
