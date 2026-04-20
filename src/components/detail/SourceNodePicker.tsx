import { memo, useMemo } from 'react';
import { FileText, Table, Globe, FileCode2, BookOpen } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';

interface SourceNodePickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function NodeIcon({ type }: { type: string }) {
  switch (type) {
    case 'table': return <Table size={12} className="shrink-0 text-green-500" strokeWidth={2} />;
    case 'pdf': return <BookOpen size={12} className="shrink-0 text-purple-500" strokeWidth={2} />;
    case 'markdown': return <FileCode2 size={12} className="shrink-0 text-blue-500" strokeWidth={2} />;
    case 'html': return <Globe size={12} className="shrink-0 text-amber-500" strokeWidth={2} />;
    case 'text':
    default: return <FileText size={12} className="shrink-0 text-blue-400" strokeWidth={2} />;
  }
}

export const SourceNodePicker = memo(function SourceNodePicker({ selectedIds, onChange }: SourceNodePickerProps) {
  const nodes = useCanvasStore((s) => s.nodes);

  // All non-AI-card, non-main nodes as potential sources
  const availableNodes = useMemo(
    () => nodes.filter((n) => n.data.type !== 'ai_card' && !n.isMain),
    [nodes]
  );

  // Also include main text nodes (module content)
  const mainNodes = useMemo(
    () => nodes.filter((n) => n.isMain && n.data.type === 'text'),
    [nodes]
  );

  const allSources = useMemo(() => [...mainNodes, ...availableNodes], [mainNodes, availableNodes]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => onChange(allSources.map((n) => n.id));
  const clearAll = () => onChange([]);

  if (allSources.length === 0) {
    return <div className="text-xs text-slate-400 py-2">当前画布暂无可选笔记</div>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">选择笔记来源</span>
        <div className="flex gap-2">
          <button onClick={selectAll} className="text-[10px] text-blue-500 hover:underline">全选</button>
          <button onClick={clearAll} className="text-[10px] text-slate-400 hover:underline">清空</button>
        </div>
      </div>
      <div className="max-h-[200px] overflow-y-auto border border-slate-200 rounded bg-white">
        {allSources.map((node) => (
          <label
            key={node.id}
            className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(node.id)}
              onChange={() => toggle(node.id)}
              className="w-3 h-3 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
            />
            <NodeIcon type={node.data.type} />
            <span className="text-xs text-slate-700 truncate flex-1">
              {node.isMain ? `[正文] ${node.data.title}` : node.data.title}
            </span>
          </label>
        ))}
      </div>
      <div className="text-[10px] text-slate-400">
        已选 {selectedIds.length} / {allSources.length} 项
      </div>
    </div>
  );
});
