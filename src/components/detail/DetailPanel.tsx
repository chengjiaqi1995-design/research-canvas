import { memo, useMemo, useCallback, lazy, Suspense } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { TextNodeData, MarkdownNodeData } from '../../types/index.ts';

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

  const handleMetadataKeyEdit = useCallback((nodeId: string, oldKey: string, newKey: string, metadata: Record<string, string>) => {
    if (newKey && newKey !== oldKey) {
      const newMeta = { ...metadata };
      newMeta[newKey] = newMeta[oldKey];
      delete newMeta[oldKey];
      updateNodeData(nodeId, { metadata: newMeta });
    }
  }, [updateNodeData]);

  const handleMetadataValueEdit = useCallback((nodeId: string, key: string, newVal: string, metadata: Record<string, string>) => {
    if (newVal !== metadata[key]) {
      updateNodeData(nodeId, { metadata: { ...metadata, [key]: newVal } });
    }
  }, [updateNodeData]);

  const handleMetadataDelete = useCallback((nodeId: string, key: string, metadata: Record<string, string>) => {
    const newMeta = { ...metadata };
    delete newMeta[key];
    updateNodeData(nodeId, { metadata: newMeta });
  }, [updateNodeData]);

  const handleMetadataAdd = useCallback((nodeId: string, metadata: Record<string, string>) => {
    const newKey = `新要素-${Date.now().toString().slice(-4)}`;
    updateNodeData(nodeId, { metadata: { ...metadata, [newKey]: '待填写' } });
  }, [updateNodeData]);

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
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center justify-between">
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

      {/* Metadata badges — editable tags below header */}
      {(() => {
        const nodeData = selectedNode.data as TextNodeData | MarkdownNodeData;
        if (nodeData.type !== 'text' && nodeData.type !== 'markdown') return null;
        const meta = nodeData.metadata;
        if (!meta) return null;
        return (
          <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-slate-100 bg-white shrink-0">
            {Object.entries(meta).map(([key, value]) => (
              <span key={key} className="group inline-flex items-center gap-1.5 bg-indigo-50/80 text-indigo-700 border border-indigo-100 rounded-full pl-2.5 pr-2 py-1 text-xs font-medium transition-colors hover:bg-indigo-100 shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus-within:ring-2 focus-within:ring-indigo-300">
                <span
                  className="opacity-70 font-semibold outline-none cursor-text border-b border-transparent focus:border-indigo-400 pb-[1px]"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    let newKey = e.currentTarget.textContent || '';
                    if (newKey.endsWith(':')) newKey = newKey.slice(0, -1);
                    handleMetadataKeyEdit(selectedNode.id, key, newKey, meta);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                >
                  {key}:
                </span>
                <span
                  className="outline-none min-w-[20px] cursor-text border-b border-transparent focus:border-indigo-400 pb-[1px]"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => handleMetadataValueEdit(selectedNode.id, key, e.currentTarget.textContent || '', meta)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                >
                  {value}
                </span>
                <button
                  onClick={() => handleMetadataDelete(selectedNode.id, key, meta)}
                  className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-indigo-200 text-indigo-400 hover:text-indigo-800 transition-all font-bold cursor-pointer outline-none"
                  title="删除要素"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              onClick={() => handleMetadataAdd(selectedNode.id, meta)}
              className="inline-flex items-center justify-center bg-gray-50/80 text-gray-500 border border-gray-200 border-dashed rounded-full px-3 py-1 text-xs font-medium transition-colors hover:bg-gray-100 hover:text-gray-700 cursor-pointer shadow-sm"
              title="添加新要素"
            >
              + 添加要素
            </button>
          </div>
        );
      })()}

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
