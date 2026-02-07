import { memo } from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useCanvas } from '../../hooks/useCanvas.ts';

export const CanvasToolbar = memo(function CanvasToolbar() {
  const { addTextNode, addTableNode } = useCanvas();
  const reactFlowInstance = useReactFlow();

  const getCenter = () => {
    const viewport = reactFlowInstance.getViewport();
    // Get the center of the visible canvas area
    const x = (-viewport.x + 400) / viewport.zoom;
    const y = (-viewport.y + 300) / viewport.zoom;
    return { x, y };
  };

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-white rounded-lg shadow-md border border-slate-200 px-2 py-1">
      <button
        onClick={() => addTextNode(getCenter())}
        className="px-2 py-1 text-xs rounded hover:bg-blue-50 text-slate-600 hover:text-blue-600"
        title="添加文本节点 (Ctrl+1)"
      >
        文本
      </button>

      <div className="w-px h-5 bg-slate-200" />

      <button
        onClick={() => addTableNode(getCenter())}
        className="px-2 py-1 text-xs rounded hover:bg-green-50 text-slate-600 hover:text-green-600"
        title="添加表格节点 (Ctrl+2)"
      >
        表格
      </button>

      <div className="w-px h-5 bg-slate-200" />

      <button
        onClick={() => reactFlowInstance.zoomIn()}
        className="p-1 rounded hover:bg-slate-100 text-slate-500"
        title="放大"
      >
        <ZoomIn size={14} />
      </button>
      <button
        onClick={() => reactFlowInstance.zoomOut()}
        className="p-1 rounded hover:bg-slate-100 text-slate-500"
        title="缩小"
      >
        <ZoomOut size={14} />
      </button>
      <button
        onClick={() => reactFlowInstance.fitView({ padding: 0.2 })}
        className="p-1 rounded hover:bg-slate-100 text-slate-500"
        title="适应视图"
      >
        <Maximize size={14} />
      </button>
    </div>
  );
});
