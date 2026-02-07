import { memo, useMemo, useCallback, useRef, useState } from 'react';
import { FileText, Table2, Plus, Upload, Trash2 } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { parseExcelFile } from '../../utils/excelImport.ts';
import { generateId } from '../../utils/id.ts';
import type { CanvasNode } from '../../types/index.ts';

export const FileColumn = memo(function FileColumn() {
  const modules = useCanvasStore((s) => s.modules);
  const nodes = useCanvasStore((s) => s.nodes);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const { addTextNode, addTableNode } = useCanvas();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuModule, setAddMenuModule] = useState<string | undefined>(undefined);

  // Get all non-main nodes, grouped by module
  const groupedFiles = useMemo(() => {
    const subNodes = nodes.filter((n) => !n.isMain);
    const groups: { moduleId: string; moduleName: string; nodes: CanvasNode[] }[] = [];

    // Group by module (in module order)
    const sortedModules = [...modules].sort((a, b) => a.order - b.order);
    for (const mod of sortedModules) {
      const modNodes = subNodes.filter((n) => n.module === mod.id);
      if (modNodes.length > 0) {
        groups.push({ moduleId: mod.id, moduleName: mod.name, nodes: modNodes });
      }
    }

    // Uncategorized nodes (no module or unknown module)
    const moduleIds = new Set(modules.map((m) => m.id));
    const uncat = subNodes.filter((n) => !n.module || !moduleIds.has(n.module));
    if (uncat.length > 0) {
      groups.push({ moduleId: '', moduleName: '未分类', nodes: uncat });
    }

    return groups;
  }, [modules, nodes]);

  const handleImportExcel = useCallback(async (file: File, moduleId?: string) => {
    try {
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
        const lastNodeId = useCanvasStore.getState().nodes[useCanvasStore.getState().nodes.length - 1]?.id;
        if (lastNodeId) selectNode(lastNodeId);
      }
    } catch (err) {
      console.error('Excel import failed:', err);
    }
  }, [addNode, selectNode]);

  const handleAddText = useCallback((moduleId?: string) => {
    const node = addTextNode({ x: 0, y: 0 }, moduleId);
    selectNode(node.id);
    setShowAddMenu(false);
  }, [addTextNode, selectNode]);

  const handleAddTable = useCallback((moduleId?: string) => {
    const node = addTableNode({ x: 0, y: 0 }, moduleId);
    selectNode(node.id);
    setShowAddMenu(false);
  }, [addTableNode, selectNode]);

  const handleDeleteNode = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    removeNode(nodeId);
  }, [removeNode]);

  const totalFiles = groupedFiles.reduce((sum, g) => sum + g.nodes.length, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleImportExcel(file, addMenuModule);
            e.target.value = '';
          }
          setShowAddMenu(false);
        }}
      />

      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          文件 <span className="text-slate-400 font-normal">({totalFiles})</span>
        </span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {groupedFiles.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-slate-300 px-4 text-center">
            暂无文件，点击下方按钮添加
          </div>
        ) : (
          groupedFiles.map((group) => (
            <div key={group.moduleId || '__uncat'}>
              {/* Group header */}
              <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                {group.moduleName}
              </div>

              {/* Files in group */}
              {group.nodes.map((node) => {
                const isSelected = selectedNodeId === node.id;
                const isTable = node.data.type === 'table';

                return (
                  <div
                    key={node.id}
                    onClick={() => selectNode(node.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-b border-slate-50 transition-colors group
                      ${isSelected
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-50'
                      }`}
                  >
                    {isTable ? (
                      <Table2 size={12} className="shrink-0 text-green-500" />
                    ) : (
                      <FileText size={12} className="shrink-0 text-blue-400" />
                    )}
                    <span className="flex-1 truncate">{node.data.title}</span>
                    {isTable && node.data.type === 'table' && (
                      <span className="text-[9px] text-slate-400 shrink-0">
                        {node.data.rows.length}×{node.data.columns.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => handleDeleteNode(e, node.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0 p-0.5 transition-opacity"
                      title="删除"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Add actions */}
      <div className="px-3 py-2 border-t border-slate-200 bg-white shrink-0 relative">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition-colors"
          >
            <Plus size={13} />
            添加文件
          </button>
        </div>

        {showAddMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
            <div className="absolute left-3 bottom-10 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20 min-w-[160px]">
              {/* Module selection */}
              <div className="px-3 py-1 text-[10px] text-slate-400 font-semibold">选择模块</div>
              {[...modules].sort((a, b) => a.order - b.order).map((mod) => (
                <button
                  key={mod.id}
                  onClick={() => setAddMenuModule(mod.id)}
                  className={`block w-full text-left px-3 py-1 text-xs transition-colors
                    ${addMenuModule === mod.id ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {mod.name}
                </button>
              ))}
              <button
                onClick={() => setAddMenuModule(undefined)}
                className={`block w-full text-left px-3 py-1 text-xs transition-colors
                  ${addMenuModule === undefined ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                不关联模块
              </button>

              <div className="border-t border-slate-100 my-1" />

              {/* Action buttons */}
              <button
                onClick={() => handleAddText(addMenuModule)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <FileText size={12} className="text-blue-400" />
                新建文本
              </button>
              <button
                onClick={() => handleAddTable(addMenuModule)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Table2 size={12} className="text-green-500" />
                新建表格
              </button>
              <button
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Upload size={12} className="text-orange-400" />
                导入 Excel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
