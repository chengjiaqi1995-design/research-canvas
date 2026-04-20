import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { FileText } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { MarkdownNodeData } from '../../types/index.ts';

export const MarkdownNode = memo(function MarkdownNode({ id, data }: NodeProps & { data: MarkdownNodeData }) {
    const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
    const selectNode = useCanvasStore((s) => s.selectNode);
    const isSelected = selectedNodeId === id;

    return (
        <>
            <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-blue-400" />
            <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-blue-400" />

            <div
                onClick={() => selectNode(id)}
                className={`bg-white rounded shadow-sm overflow-hidden cursor-pointer w-[200px] transition-all
          ${isSelected
                        ? 'border-2 border-blue-500 ring-2 ring-blue-100 shadow-md'
                        : 'border-2 border-slate-200 hover:border-blue-300 hover:shadow-md'
                    }`}
            >
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50">
                    <div className="relative shrink-0">
                        <FileText size={16} className="text-blue-500" />
                        <div className="absolute -bottom-0.5 -right-1 text-[7px] bg-white rounded-full leading-none text-blue-600 font-bold px-0.5">M</div>
                    </div>
                    <span className="text-xs font-medium text-slate-700 truncate">{data.title}</span>
                </div>
            </div>
        </>
    );
});
