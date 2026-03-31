import { memo, useMemo, useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { X, Loader2, ArrowRightLeft } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { canvasApi } from '../../db/apiClient.ts';

const NoteEditor = lazy(() =>
  import('./NoteEditor.tsx').then((m) => ({ default: m.NoteEditor }))
);
const SpreadsheetEditor = lazy(() =>
  import('./SpreadsheetEditor.tsx').then((m) => ({ default: m.SpreadsheetEditor }))
);
const PdfNode = lazy(() =>
  import('../nodes/PdfNode.tsx').then((m) => ({ default: m.PdfNode }))
);
const HtmlViewer = lazy(() =>
  import('./HtmlViewer.tsx').then((m) => ({ default: m.HtmlViewer }))
);

export const DetailPanel = memo(function DetailPanel() {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, nodes]);

  const currentCanvasId = useCanvasStore((s) => s.currentCanvasId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  // Move to canvas state
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [allCanvases, setAllCanvases] = useState<any[]>([]);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (showMoveMenu && allCanvases.length === 0) {
      canvasApi.list().then(setAllCanvases).catch(console.error);
    }
  }, [showMoveMenu]);

  const handleMoveNode = useCallback(async (targetCanvasId: string) => {
    if (!selectedNode || !currentCanvasId || moving) return;
    setMoving(true);
    try {
      await canvasApi.moveNode(selectedNode.id, currentCanvasId, targetCanvasId);
      // Remove from local state
      const removeNode = useCanvasStore.getState().removeNode;
      removeNode(selectedNode.id);
      setShowMoveMenu(false);
    } catch (err: any) {
      alert(`移动失败: ${err.message}`);
    }
    setMoving(false);
  }, [selectedNode, currentCanvasId, moving]);

  const handleStartEditTitle = useCallback(() => {
    if (selectedNode) {
      setEditTitle(selectedNode.data.title || '');
      setIsEditingTitle(true);
    }
  }, [selectedNode]);

  const handleSaveTitle = useCallback(() => {
    if (editTitle.trim() && selectedNode) {
      updateNodeData(selectedNode.id, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, selectedNode, updateNodeData]);

  if (!selectedNode) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        点击画布上的节点查看详情
      </div>
    );
  }

  const tags = (selectedNode.data as any).tags as string[] | undefined;
  const showTags = (selectedNode.data.type === 'markdown' || selectedNode.data.type === 'text') && Array.isArray(tags) && tags.length > 0;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Panel header */}
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center justify-between gap-2">
          {/* Editable title */}
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                onBlur={handleSaveTitle}
                className="w-full text-sm font-medium border-b-2 border-blue-400 outline-none pb-0.5 bg-transparent text-slate-700"
              />
            ) : (
              <span
                className="text-sm font-medium text-slate-700 truncate block cursor-pointer hover:text-blue-600 transition-colors"
                onClick={handleStartEditTitle}
                title="点击编辑标题"
              >
                {selectedNode.data.title}
              </span>
            )}
          </div>
          {/* Tags in header, right side */}
          {showTags && (
            <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
              {tags!.map((tag, idx) => (
                <span key={idx} className="group inline-flex items-center gap-0.5 bg-gray-100/80 text-gray-500 border border-gray-200 rounded-full pl-2 pr-1 py-0.5 text-[10px] font-medium hover:bg-gray-200">
                  <span
                    className="outline-none min-w-[16px] cursor-text border-b border-transparent focus:border-gray-400"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const newVal = e.currentTarget.textContent || '';
                      const newTags = [...tags!];
                      if (newVal.trim() === '') {
                        newTags.splice(idx, 1);
                      } else {
                        newTags[idx] = newVal.trim();
                      }
                      if (JSON.stringify(newTags) !== JSON.stringify(tags)) {
                        updateNodeData(selectedNode.id, { tags: newTags });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  >
                    {tag}
                  </span>
                  <button
                    onClick={() => {
                      const newTags = [...tags!];
                      newTags.splice(idx, 1);
                      updateNodeData(selectedNode.id, { tags: newTags });
                    }}
                    className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-3 h-3 rounded-full hover:bg-gray-300 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
                    title="删除标签"
                  >
                    x
                  </button>
                </span>
              ))}
              <button
                onClick={() => {
                  const newTags = [...(tags || []), '新标签'];
                  updateNodeData(selectedNode.id, { tags: newTags });
                }}
                className="inline-flex items-center text-gray-400 border border-gray-200 border-dashed rounded-full px-1.5 py-0.5 text-[10px] hover:bg-gray-100 hover:text-gray-600 cursor-pointer"
                title="添加标签"
              >
                +
              </button>
            </div>
          )}
          {/* Move to canvas */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="p-1 rounded hover:bg-slate-200 text-slate-400"
              title="移动到其他画布"
            >
              <ArrowRightLeft size={14} />
            </button>
            {showMoveMenu && (
              <div className="absolute right-0 top-8 w-[260px] bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-[400px] overflow-y-auto">
                <div className="px-3 py-1.5 text-[10px] text-slate-400 font-medium border-b border-slate-100 sticky top-0 bg-white">
                  移动到画布...
                </div>
                {(() => {
                  // Group canvases by workspace, current workspace first
                  const wsById = new Map(workspaces.map(w => [w.id, w]));
                  const grouped = new Map<string, { wsName: string; canvases: any[] }>();
                  for (const c of allCanvases) {
                    if (c.id === currentCanvasId) continue; // skip current
                    const ws = wsById.get(c.workspaceId);
                    const wsName = ws?.name || '未知';
                    if (!grouped.has(c.workspaceId)) {
                      grouped.set(c.workspaceId, { wsName, canvases: [] });
                    }
                    grouped.get(c.workspaceId)!.canvases.push(c);
                  }
                  // Sort: current workspace first
                  const entries = [...grouped.entries()].sort((a, b) => {
                    if (a[0] === currentWorkspaceId) return -1;
                    if (b[0] === currentWorkspaceId) return 1;
                    return a[1].wsName.localeCompare(b[1].wsName);
                  });
                  return entries.map(([wsId, { wsName, canvases }]) => (
                    <div key={wsId}>
                      <div className="px-3 py-1 text-[10px] text-slate-500 font-medium bg-slate-50 sticky">
                        {wsName} {wsId === currentWorkspaceId && '(当前)'}
                      </div>
                      {canvases.map(c => (
                        <button
                          key={c.id}
                          onClick={() => handleMoveNode(c.id)}
                          disabled={moving}
                          className="w-full text-left px-4 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                        >
                          {c.title || c.id}
                        </button>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
          <button
            onClick={() => selectNode(null)}
            className="p-1 rounded hover:bg-slate-200 text-slate-400 flex-shrink-0"
            title="关闭面板"
          >
            <X size={16} />
          </button>
        </div>
        {/* Metadata info strip — dot separated compact view */}
        {(() => {
          const meta = (selectedNode.data as any).metadata as Record<string, string> | undefined;
          if (!meta) return null;
          const fields = ['公司', '行业', '参与人', '中介', '国家', '发生日期', '创建时间'];
          const parts = fields.filter(k => meta[k]).map(k => meta[k]);
          if (parts.length === 0) return null;
          return (
            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-400 mt-1">
              {parts.map((val, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-slate-300 mr-1.5">·</span>}
                  <span className="hover:text-blue-500 transition-colors">{val}</span>
                </span>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400"><Loader2 className="animate-spin mr-2" size={16} />加载中...</div>}>
          {selectedNode.data.type === 'text' && (
            <NoteEditor key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data} />
          )}
          {selectedNode.data.type === 'table' && (
            <SpreadsheetEditor key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data} />
          )}
          {selectedNode.data.type === 'pdf' && (
            <PdfNode key={selectedNode.id} data={selectedNode.data} />
          )}
          {selectedNode.data.type === 'html' && (
            <HtmlViewer key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data as import('../../types/index.ts').HtmlNodeData} />
          )}
          {selectedNode.data.type === 'markdown' && (
            <NoteEditor key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data as import('../../types/index.ts').MarkdownNodeData} />
          )}
        </Suspense>
      </div>
    </div>
  );
});
