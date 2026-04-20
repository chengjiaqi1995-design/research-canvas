import { memo, useMemo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import type { AICardNodeData } from '../../types/index.ts';

export const AICardNode = memo(function AICardNode({ id, data }: NodeProps & { data: AICardNodeData }) {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const isSelected = selectedNodeId === id;

  const preview = useMemo(() => {
    const text = data.editedContent || data.generatedContent || data.prompt || '';
    const plain = text.replace(/<[^>]*>/g, '').replace(/[#*_~`]/g, '');
    return plain.length > 80 ? plain.slice(0, 80) + '...' : plain;
  }, [data.editedContent, data.generatedContent, data.prompt]);

  const sourceLabel = data.config.sourceMode === 'web' ? '联网' : data.config.sourceMode === 'notes_web' ? '笔记+联网' : '笔记';

  return (
    <>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-blue-400" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-blue-400" />

      <div
        onClick={() => selectNode(id)}
        className={`bg-white rounded-md shadow-sm overflow-hidden cursor-pointer w-[200px] transition-all
          ${isSelected
            ? 'border-2 border-blue-500 ring-2 ring-blue-100 shadow-md'
            : 'border-2 border-slate-200 hover:border-blue-300 hover:shadow-md'
          }`}
      >
        <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-1.5">
          {data.isStreaming ? (
            <Loader2 size={11} className="text-blue-500 animate-spin shrink-0" />
          ) : (
            <Sparkles size={11} className="text-blue-500 shrink-0" />
          )}
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{data.title}</span>
        </div>
        <div className="px-3 py-2 text-[11px] text-slate-500 leading-relaxed line-clamp-3">
          {preview || '点击配置并生成...'}
        </div>
        <div className="px-3 py-1 border-t border-slate-100 flex items-center gap-2 text-[9px] text-slate-400">
          <span>{data.config.model.split('-').slice(0, 2).join('-')}</span>
          <span>{sourceLabel}</span>
        </div>
      </div>
    </>
  );
});
