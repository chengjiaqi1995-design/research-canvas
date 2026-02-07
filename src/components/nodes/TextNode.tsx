import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { TextNodeData } from '../../types/index.ts';

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

export const TextNode = memo(function TextNode({ id, data }: NodeProps & { data: TextNodeData }) {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const isSelected = selectedNodeId === id;

  const preview = useMemo(() => {
    const text = stripHtml(data.content);
    return text.length > 100 ? text.slice(0, 100) + '...' : text;
  }, [data.content]);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-blue-400" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-blue-400" />

      <div
        onClick={() => selectNode(id)}
        className={`bg-white rounded-lg shadow-sm overflow-hidden cursor-pointer w-[200px] transition-all
          ${isSelected
            ? 'border-2 border-blue-500 ring-2 ring-blue-100 shadow-md'
            : 'border-2 border-slate-200 hover:border-blue-300 hover:shadow-md'
          }`}
      >
        <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100">
          <span className="text-xs font-medium text-slate-700 truncate block">{data.title}</span>
        </div>
        <div className="px-3 py-2 text-[11px] text-slate-500 leading-relaxed line-clamp-3">
          {preview || '空笔记...'}
        </div>
      </div>
    </>
  );
});
