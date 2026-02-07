import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { TableNodeData } from '../../types/index.ts';

export const TableNode = memo(function TableNode({ id, data }: NodeProps & { data: TableNodeData }) {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const isSelected = selectedNodeId === id;

  const summary = useMemo(() => {
    return `${data.rows.length}行×${data.columns.length}列`;
  }, [data.rows.length, data.columns.length]);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-green-400" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-green-400" />

      <div
        onClick={() => selectNode(id)}
        className={`bg-white rounded-lg shadow-sm overflow-hidden cursor-pointer w-[200px] transition-all
          ${isSelected
            ? 'border-2 border-green-500 ring-2 ring-green-100 shadow-md'
            : 'border-2 border-slate-200 hover:border-green-300 hover:shadow-md'
          }`}
      >
        <div className="flex items-center px-3 py-2 bg-green-50">
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{data.title}</span>
          <span className="text-[10px] text-slate-400 shrink-0">{summary}</span>
        </div>
      </div>
    </>
  );
});
