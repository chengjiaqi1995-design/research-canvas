import { memo } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

export const Header = memo(function Header() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);
  const currentCanvas = canvases.find((c) => c.id === currentCanvasId);

  return (
    <div className="flex items-center h-10 px-4 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-2 text-sm">
        {currentWorkspace && (
          <span className="text-slate-500">{currentWorkspace.name}</span>
        )}
        {currentCanvas && (
          <>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-800">{currentCanvas.title}</span>
          </>
        )}
        {!currentWorkspace && (
          <span className="text-slate-400">选择或创建一个工作区开始</span>
        )}
      </div>
    </div>
  );
});
