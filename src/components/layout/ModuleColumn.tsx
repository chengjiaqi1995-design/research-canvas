import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { InlineAICard } from './InlineAICard.tsx';
import type { ModuleConfig, CanvasNode, AICardNodeData } from '../../types/index.ts';

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
  aiCardNodes,
  heightRatio,
  sortedIndex,
  dragModIndex,
  dropModIndex,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  module: ModuleConfig;
  mainNode: CanvasNode | null;
  aiCardNodes: CanvasNode[];
  heightRatio: number;
  sortedIndex: number;
  dragModIndex: number | null;
  dropModIndex: number | null;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
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

  const isDragging = dragModIndex === sortedIndex;
  const isDropTarget = dropModIndex === sortedIndex && dragModIndex !== null && dragModIndex !== sortedIndex;

  return (
    <div
      id={`module-${module.id}`}
      className="border-b border-slate-200 flex flex-col overflow-hidden"
      style={{
        ...(collapsed ? {} : { flex: heightRatio }),
        opacity: isDragging ? 0.4 : 1,
        borderTop: isDropTarget ? '2px solid #3b82f6' : '2px solid transparent',
      }}
    >
      {/* Header bar — drag handle */}
      <div
        className="flex items-center gap-1 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors shrink-0"
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(sortedIndex);
        }}
        onDragOver={(e) => onDragOver(e, sortedIndex)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, sortedIndex)}
        onDragEnd={onDragEnd}
        style={{ cursor: isEditing ? 'text' : 'grab' }}
      >
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

      {/* Content: editor + AI cards */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 80 }}>
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

          {/* AI Cards (created from file list, rendered inline) */}
          {aiCardNodes.map((node) => (
            <InlineAICard
              key={node.id}
              nodeId={node.id}
              data={node.data as AICardNodeData}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const ModuleColumn = memo(function ModuleColumn() {
  const modules = useCanvasStore((s) => s.modules);
  const nodes = useCanvasStore((s) => s.nodes);
  const addModule = useCanvasStore((s) => s.addModule);
  const reorderModules = useCanvasStore((s) => s.reorderModules);

  // Module drag reorder state
  const [dragModIndex, setDragModIndex] = useState<number | null>(null);
  const [dropModIndex, setDropModIndex] = useState<number | null>(null);

  const handleModDragStart = useCallback((index: number) => setDragModIndex(index), []);
  const handleModDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropModIndex(index);
  }, []);
  const handleModDragLeave = useCallback(() => setDropModIndex(null), []);
  const handleModDrop = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragModIndex !== null && dragModIndex !== index) {
      reorderModules(dragModIndex, index);
    }
    setDragModIndex(null);
    setDropModIndex(null);
  }, [dragModIndex, reorderModules]);
  const handleModDragEnd = useCallback(() => {
    setDragModIndex(null);
    setDropModIndex(null);
  }, []);

  // Height ratios for each module (keyed by module id)
  const [heightRatios, setHeightRatios] = useState<Record<string, number>>({});
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

  // Find AI card nodes per module
  const aiCardNodeMap = useMemo(() => {
    const map: Record<string, CanvasNode[]> = {};
    for (const mod of modules) {
      map[mod.id] = nodes.filter(
        (n) => n.module === mod.id && n.data.type === 'ai_card'
      );
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
      const totalRatio = expandedModules.reduce((sum, m) => sum + (heightRatios[m.id] ?? 1), 0);
      const deltaRatio = (deltaY / totalH) * totalRatio;

      setHeightRatios((prev) => {
        const topR = (prev[topModId] ?? 1) + deltaRatio;
        const bottomR = (prev[bottomModId] ?? 1) - deltaRatio;
        if (topR < 0.2 || bottomR < 0.2) return prev;
        return { ...prev, [topModId]: topR, [bottomModId]: bottomR };
      });
    },
    [expandedModules, heightRatios]
  );

  return (
    <div ref={containerRef} className="flex h-full">
      {/* Left: modules column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {sortedModules.map((mod) => {
            const collapsed = mod.collapsed ?? false;
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
                  aiCardNodes={aiCardNodeMap[mod.id] || []}
                  heightRatio={getRatio(mod.id)}
                  sortedIndex={sortedModules.indexOf(mod)}
                  dragModIndex={dragModIndex}
                  dropModIndex={dropModIndex}
                  onDragStart={handleModDragStart}
                  onDragOver={handleModDragOver}
                  onDragLeave={handleModDragLeave}
                  onDrop={handleModDrop}
                  onDragEnd={handleModDragEnd}
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
    </div>
  );
});
