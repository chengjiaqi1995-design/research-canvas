import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, X, Layers } from 'lucide-react';
import { useCreateBlockNote, getDefaultReactSlashMenuItems, SuggestionMenuController } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../../blocknote-overrides.css';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { fileApi } from '../../db/apiClient.ts';
import type { ModuleConfig, CanvasNode, CanvasAttachmentReference } from '../../types/index.ts';
import { schema } from '../editor/schema.ts';
import { useInlineAIStore } from '../editor/inlineAIStore.ts';
import { ATTACHMENT_REF_TOKEN_PREFIX, escapeHtml, extractAttachmentReferenceIds, truncate } from '../../hooks/useAttachmentReferences.ts';

/** Inline BlockNote editor for a module's main text node */
function renderReferenceCard(reference: CanvasAttachmentReference, onOpen: () => void) {
  const card = document.createElement('button');
  card.type = 'button';
  card.contentEditable = 'false';
  card.className = 'canvas-attachment-reference my-2 block w-full rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-left shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50';
  card.title = `打开原文：${reference.sourceTitle}`;
  card.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen();
  });

  const sourceLabel = reference.sourceType === 'table'
    ? 'Excel'
    : reference.sourceType === 'html'
      ? 'HTML'
      : reference.sourceType === 'markdown'
        ? 'MD'
        : '文本';

  const preview = reference.preview?.kind === 'table'
    ? `<div class="mt-2 overflow-hidden rounded border border-blue-100 bg-white">
        <table class="w-full border-collapse text-[10px] text-slate-600">
          ${reference.preview.columns?.length ? `<thead><tr>${reference.preview.columns.map((col) => `<th class="border-b border-blue-50 px-1.5 py-1 text-left font-semibold">${escapeHtml(col)}</th>`).join('')}</tr></thead>` : ''}
          <tbody>${(reference.preview.rows || []).map((row) => `<tr>${row.map((cell) => `<td class="border-b border-blue-50 px-1.5 py-1">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`
    : reference.quote
      ? `<div class="mt-1 text-[12px] leading-5 text-slate-700">${escapeHtml(truncate(reference.quote, 220))}</div>`
      : '';

  card.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
          <span>${sourceLabel} 引用</span>
          <span class="text-blue-300">·</span>
          <span class="truncate normal-case tracking-normal text-slate-400">${escapeHtml(reference.sourceTitle)}</span>
        </div>
        <div class="mt-1 text-[13px] font-semibold text-slate-900">${escapeHtml(reference.title || '附件引用')}</div>
        ${reference.note ? `<div class="mt-1 text-[12px] text-slate-600">${escapeHtml(reference.note)}</div>` : ''}
      </div>
      <span class="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-blue-600">打开原文</span>
    </div>
    ${preview}
  `;
  return card;
}

function ModuleEditor({ nodeId, content, references = [] }: { nodeId: string; content: string; references?: CanvasAttachmentReference[] }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const openAttachmentReference = useCanvasStore((s) => s.openAttachmentReference);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const knownReferenceIdsRef = useRef<Set<string>>(new Set(extractAttachmentReferenceIds(content || '')));

  const editor = useCreateBlockNote({
    schema,
    initialContent: undefined,
    uploadFile: async (file: File) => {
      try {
        const uploaded = await fileApi.uploadAny(file);
        return {
          props: {
            url: uploaded.url,
            name: uploaded.originalName || file.name,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知错误';
        window.setTimeout(() => {
          alert(`附件上传失败：${file.name}\n${message}`);
        }, 0);
        throw err;
      }
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

  useEffect(() => {
    const incomingIds = references.map((reference) => reference.id);
    const missing = incomingIds.filter((id) => !knownReferenceIdsRef.current.has(id));
    if (!missing.length || !editor.document?.length) return;

    const lastBlock = editor.document[editor.document.length - 1];
    editor.insertBlocks(
      missing.map((id) => ({ type: 'paragraph' as const, content: `{{${ATTACHMENT_REF_TOKEN_PREFIX}:${id}}}` })),
      lastBlock,
      'after',
    );
    missing.forEach((id) => knownReferenceIdsRef.current.add(id));
  }, [editor, references]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const byId = new Map(references.map((reference) => [reference.id, reference]));
    const processReferenceTokens = () => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (parent?.closest?.('.canvas-attachment-reference')) return NodeFilter.FILTER_REJECT;
          return node.textContent?.includes(`{{${ATTACHMENT_REF_TOKEN_PREFIX}:`)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });

      const textNodes: Text[] = [];
      let current: Text | null;
      while ((current = walker.nextNode() as Text | null)) textNodes.push(current);

      for (const textNode of textNodes) {
        const text = textNode.textContent || '';
        const parts = text.split(/(\{\{RC_REF:[^}]+\}\})/g);
        if (parts.length <= 1) continue;
        const fragment = document.createDocumentFragment();
        for (const part of parts) {
          const match = part.match(/^\{\{RC_REF:([^}]+)\}\}$/);
          if (!match) {
            if (part) fragment.appendChild(document.createTextNode(part));
            continue;
          }
          const reference = byId.get(match[1]);
          if (!reference) {
            fragment.appendChild(document.createTextNode(part));
            continue;
          }
          fragment.appendChild(renderReferenceCard(reference, () => openAttachmentReference(reference)));
        }
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
    };

    const timer = window.setTimeout(processReferenceTokens, 100);
    const observer = new MutationObserver(() => window.setTimeout(processReferenceTokens, 100));
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [openAttachmentReference, references]);

  const handleChange = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      let html = await editor.blocksToHTMLLossy();
      // preserve empty lines
      html = html.replace(/<p><\/p>/g, '<p><br></p>');
      updateNodeData(nodeId, { content: html });
    }, 500);
  }, [editor, nodeId, updateNodeData]);

  useEffect(() => {
    return () => {
      // Abort all active inline AI streaming
      useInlineAIStore.getState().abortAll();

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        try {
          const html = editor.blocksToHTMLLossy();
          if (html && typeof html === 'string') {
            updateNodeData(nodeId, { content: html });
          }
        } catch {
          // ignore
        }
      }
    };
  }, [editor, nodeId, updateNodeData]);

  return (
    <div ref={editorContainerRef}>
      <BlockNoteView
        editor={editor}
        onChange={handleChange}
        theme="light"
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => {
            const defaultItems = getDefaultReactSlashMenuItems(editor);
            const aiItem = {
              title: 'AI 生成块',
              subtext: '插入 AI 分析/生成块',
              aliases: ['ai', 'generate', '智能', '生成', 'aiblock'],
              group: 'AI',
              onItemClick: () => {
                const currentBlock = editor.getTextCursorPosition().block;
                editor.insertBlocks(
                  [{
                    type: 'aiInline' as any,
                    props: {
                      blockId: crypto.randomUUID(),
                      status: 'idle',
                    },
                  }],
                  currentBlock,
                  'after'
                );
              },
            };
            return [aiItem, ...defaultItems].filter(
              (item) => {
                const q = query.toLowerCase();
                return !q ||
                  item.title.toLowerCase().includes(q) ||
                  item.aliases?.some((a: string) => a.toLowerCase().includes(q)) ||
                  item.group?.toLowerCase().includes(q);
              }
            );
          }}
        />
      </BlockNoteView>
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

/** Visual stack indicator for grouped collapsed modules */
function StackedModulesItem({ count, onClick }: { count: number, onClick: () => void }) {
  return (
    <div 
      className="cursor-pointer group flex items-center justify-between px-2 py-1.5 shrink-0 transition-colors relative"
      onClick={onClick}
      title="点击展开堆叠"
    >
      {/* Background with fake stacked borders */}
      <div className="absolute inset-0 bg-slate-50 border-b border-slate-200 group-hover:bg-slate-100 transition-colors" style={{ zIndex: 0 }} />
      <div className="absolute left-1 right-1 bottom-0 h-full bg-slate-100 border-b border-slate-300 rounded-b-sm" style={{ transform: 'translateY(3px)', zIndex: -1 }} />
      <div className="absolute left-2 right-2 bottom-0 h-full bg-slate-200 border-b border-slate-400 rounded-b-sm" style={{ transform: 'translateY(6px)', zIndex: -2 }} />
      
      <div className="relative z-10 flex items-center gap-1.5 text-slate-500">
         <Layers size={13} className="text-amber-600" />
         <span className="text-xs font-semibold text-slate-600">
           已折叠 {count} 个连续模块
         </span>
      </div>
      <div className="relative z-10 text-[10px] font-medium text-slate-400 group-hover:text-amber-600 transition-colors">
         点击展开堆叠
      </div>
    </div>
  );
}

/** Single collapsible module section with inline file list */
function ModuleItem({
  module,
  mainNode,
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
        className={`flex items-center gap-1.5 px-2 ${collapsed ? 'py-0.5 border-b-0' : 'py-1.5'} bg-slate-50 hover:bg-slate-100 transition-colors shrink-0`}
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
            className="flex-1 text-[13px] font-semibold border-b border-blue-400 outline-none bg-transparent"
          />
        ) : (
          <span
            className={`flex-1 cursor-pointer truncate ${collapsed ? 'text-[12px] font-medium text-slate-600' : 'text-[13px] font-semibold text-slate-700'}`}
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
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 64 }}>
          {mainNode && mainNode.data.type === 'text' ? (
            <ModuleEditor
              key={mainNode.id}
              nodeId={mainNode.id}
              content={mainNode.data.content}
              references={mainNode.data.references || []}
            />
          ) : (
            <div className="flex items-center justify-center h-16 text-xs text-slate-300">
              加载中...
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

  const [unpackedStacks, setUnpackedStacks] = useState<Set<string>>(new Set());

  const displaySegments = useMemo(() => {
    const segments: ({ type: 'module', mod: ModuleConfig, index: number } | { type: 'stack', mods: ModuleConfig[], key: string })[] = [];
    let currentStreak: { mod: ModuleConfig, idx: number }[] = [];

    const commitStreak = () => {
      if (currentStreak.length > 0) {
        const stackKey = currentStreak.map(m => m.mod.id).join(',');
        if (currentStreak.length > 3 && !unpackedStacks.has(stackKey)) {
          segments.push({ type: 'stack', mods: currentStreak.map(m => m.mod), key: stackKey });
        } else {
          currentStreak.forEach(item => segments.push({ type: 'module', mod: item.mod, index: item.idx }));
        }
        currentStreak = [];
      }
    };

    sortedModules.forEach((mod, idx) => {
      if (mod.collapsed) {
        currentStreak.push({ mod, idx });
      } else {
        commitStreak();
        segments.push({ type: 'module', mod, index: idx });
      }
    });
    commitStreak();
    return segments;
  }, [sortedModules, unpackedStacks]);

  return (
    <div ref={containerRef} className="flex h-full pb-1">
      {/* Left: modules column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden">
          {displaySegments.map((seg, i) => {
            if (seg.type === 'stack') {
              return (
                <div key={seg.key} className="mb-1 shrink-0">
                  <StackedModulesItem 
                    count={seg.mods.length} 
                    onClick={() => setUnpackedStacks(prev => new Set(prev).add(seg.key))} 
                  />
                </div>
              );
            }

            const { mod, index: sortedIndex } = seg;
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
                  heightRatio={getRatio(mod.id)}
                  sortedIndex={sortedIndex}
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

        <div className="px-2 py-1.5 border-t border-slate-200 bg-white shrink-0">
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
