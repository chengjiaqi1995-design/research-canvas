import { memo, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { GripHorizontal, Trash2, Pencil, Check } from 'lucide-react';
import { useCanvasStore } from '../../stores/canvasStore.ts';

interface NodeWrapperProps {
  nodeId: string;
  title: string;
  icon?: ReactNode;
  headerColor?: string;
  children: ReactNode;
  className?: string;
  minWidth?: number;
}

export const NodeWrapper = memo(function NodeWrapper({
  nodeId,
  title,
  icon,
  headerColor = 'bg-white',
  children,
  className = '',
  minWidth = 280,
}: NodeWrapperProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(title);

  const handleSaveTitle = useCallback(() => {
    if (editTitle.trim()) {
      updateNodeData(nodeId, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, nodeId, updateNodeData]);

  return (
    <div
      className={`bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden ${className}`}
      style={{ minWidth }}
    >
      {/* Title bar - draggable */}
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 ${headerColor} border-b border-slate-100 cursor-grab active:cursor-grabbing`}
      >
        <GripHorizontal size={12} className="text-slate-300 shrink-0 drag-handle" />
        {icon && <span className="text-sm shrink-0">{icon}</span>}

        {isEditingTitle ? (
          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setEditTitle(title);
                  setIsEditingTitle(false);
                }
              }}
              onBlur={handleSaveTitle}
              className="flex-1 px-1 py-0 text-xs font-medium border border-blue-300 rounded focus:outline-none"
            />
            <button onClick={handleSaveTitle} className="p-0.5 text-blue-500">
              <Check size={12} />
            </button>
          </div>
        ) : (
          <span
            className="text-xs font-medium text-slate-700 truncate flex-1"
            onDoubleClick={() => {
              setEditTitle(title);
              setIsEditingTitle(true);
            }}
          >
            {title}
          </span>
        )}

        <div className="flex items-center gap-0.5 ml-auto">
          <button
            onClick={() => {
              setEditTitle(title);
              setIsEditingTitle(true);
            }}
            className="p-0.5 rounded hover:bg-slate-200 text-slate-400"
            title="重命名"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={() => removeNode(nodeId)}
            className="p-0.5 rounded hover:bg-red-100 text-red-400"
            title="删除节点"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="nowheel">{children}</div>
    </div>
  );
});
