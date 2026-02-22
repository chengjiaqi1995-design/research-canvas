import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Code } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { HtmlNodeData } from '../../types/index.ts';

export const HtmlNode = memo(function HtmlNode({ id, data }: NodeProps & { data: HtmlNodeData }) {
    const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
    const selectNode = useCanvasStore((s) => s.selectNode);
    const isSelected = selectedNodeId === id;

    return (
        <>
            <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-orange-400" />
            <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-orange-400" />

            <div
                onClick={() => selectNode(id)}
                className={`bg-white rounded-lg shadow-sm overflow-hidden cursor-pointer w-[200px] transition-all
          ${isSelected
                        ? 'border-2 border-orange-500 ring-2 ring-orange-100 shadow-md'
                        : 'border-2 border-slate-200 hover:border-orange-300 hover:shadow-md'
                    }`}
            >
                <div className="flex items-center gap-2 px-3 py-2 bg-orange-50">
                    <Code size={16} className="text-orange-500 shrink-0" />
                    <span className="text-xs font-medium text-slate-700 truncate">{data.title}</span>
                </div>
            </div>
        </>
    );
});
