import { memo, useMemo, lazy, Suspense } from 'react';
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
  const nodes = useCanvasStore((s) => s.nodes);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, nodes]);

  if (!selectedNode) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        点击画布上的节点查看详情
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="text-sm font-medium text-slate-700 truncate">
          {selectedNode.data.title}
        </span>
        <button
          onClick={() => selectNode(null)}
          className="p-1 rounded hover:bg-slate-200 text-slate-400"
          title="关闭面板"
        >
          <X size={16} />
        </button>
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
