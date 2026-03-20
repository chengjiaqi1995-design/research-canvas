import { memo, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { PanelLeftOpen, PanelLeftClose, RefreshCw } from 'lucide-react';
import { Header } from './Header.tsx';
import { FolderColumn } from './FolderColumn.tsx';
import { FileListColumn } from './FileListColumn.tsx';
import { SyncDialog } from '../sync/SyncDialog.tsx';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

interface MainLayoutProps {
  children: ReactNode;
}

const FOLDER_COL_WIDTH = 220;
const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 700;

export const MainLayout = memo(function MainLayout({ children }: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const workspaceCount = useWorkspaceStore((s) => s.workspaces.length);

  // Resizable sidebar (dragging the right edge of the second column)
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - startX.current;
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center w-10 bg-slate-50 border-r border-slate-200 shrink-0 py-2">
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="p-1.5 rounded hover:bg-slate-200 text-slate-400"
              title="展开侧栏"
            >
              <PanelLeftOpen size={16} />
            </button>
          </div>
        ) : (
          /* Sidebar: unified two-column panel */
          <div className="flex flex-col h-full bg-slate-50 shrink-0 relative" style={{ width: sidebarWidth }}>
            {/* Unified header bar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 shrink-0">
              <span className="text-xs font-semibold text-slate-700">{workspaceCount} 个文件夹</span>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setShowSync(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="从 AI Notebook 同步">
                  <RefreshCw size={14} />
                </button>
                <button onClick={() => setSidebarCollapsed(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="折叠侧栏">
                  <PanelLeftClose size={14} />
                </button>
              </div>
            </div>

            {/* Two columns side by side, sharing remaining height */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              <div className="shrink-0 overflow-hidden" style={{ width: FOLDER_COL_WIDTH }}>
                <FolderColumn collapsed={false} onToggle={() => setSidebarCollapsed(true)} headerless />
              </div>
              <div className="w-px bg-slate-200 shrink-0" />
              <div className="flex-1 min-w-0 overflow-hidden">
                <FileListColumn headerless />
              </div>
            </div>

            {/* Drag handle on right edge of sidebar */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400 transition-colors z-10"
              onMouseDown={handleResizeMouseDown}
            />
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>

      <SyncDialog open={showSync} onClose={() => setShowSync(false)} />
    </div>
  );
});
