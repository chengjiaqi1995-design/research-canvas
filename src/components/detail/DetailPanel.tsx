import { memo, useMemo, useState, useCallback, lazy, Suspense } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';

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

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

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
