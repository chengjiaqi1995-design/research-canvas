import { memo, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { PanelLeftOpen, PanelLeftClose, RefreshCw, Database } from 'lucide-react';
import { Header } from './Header.tsx';
import { FolderColumn } from './FolderColumn.tsx';
import { FileListColumn } from './FileListColumn.tsx';
import { SyncDialog } from '../sync/SyncDialog.tsx';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { request } from '../../db/apiClient.ts';
import { INDUSTRY_CATEGORY_MAP, INDUSTRY_COMPANIES, INDUSTRY_SPECIAL_FOLDERS } from '../../constants/industryCategories.ts';

interface MainLayoutProps {
  children: ReactNode;
}

const FOLDER_COL_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 700;

export const MainLayout = memo(function MainLayout({ children }: MainLayoutProps) {
  const viewMode = useAICardStore((s) => s.viewMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  const handleMigration = async () => {
    setIsMigrating(true);
    try {
      const confirmMsg = `警告：这将会清空所有现有的【行业】分类下的大类以及相关画布，并根据我们最新的规则进行批量重建！整体和个人会被保留。\n是否继续？`;
      if (!window.confirm(confirmMsg)) {
        setIsMigrating(false);
        return;
      }

      let userId = '';
      try {
        const stored = localStorage.getItem('rc_auth_user');
        if (stored) {
          const parsed = JSON.parse(stored);
          userId = parsed.googleId;
        }
      } catch (e) { /* ignore */ }

      if (!userId) throw new Error('Cannot find local user identity for rebuild.');

      await request('/rebuild-industries', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          categoryMap: INDUSTRY_CATEGORY_MAP,
          companiesMap: INDUSTRY_COMPANIES,
          specialFolders: INDUSTRY_SPECIAL_FOLDERS
        })
      });

      const loadWorkspaces = useWorkspaceStore.getState().loadWorkspaces;
      await loadWorkspaces();
      alert(`🎉 恭喜！全新的极简扁平化数据结构（上百个分类与画布）已被瞬间成功建立！`);
    } catch (err: any) {
      alert(`重组失败: ${err.message}`);
    }
    setIsMigrating(false);
  };
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

  const workspaceCount = workspaces.length;
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);
  const currentCanvas = canvases.find((c) => c.id === currentCanvasId);

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
        {(viewMode === 'ai_process' || viewMode === 'ai_research' || viewMode === 'portfolio') ? null : sidebarCollapsed ? (
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
          <div className="flex flex-col h-full bg-slate-50 border-r border-slate-200 shrink-0 relative" style={{ width: sidebarWidth }}>
            {/* Unified header bar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <div className="flex items-center gap-1.5 text-[13px] truncate">
                  {currentWorkspace && (
                    <span className="text-slate-500 font-medium truncate">{currentWorkspace.name}</span>
                  )}
                  {currentCanvas && (
                    <>
                      <span className="text-slate-300 shrink-0">/</span>
                      <span className="font-semibold text-slate-800 truncate">{currentCanvas.title}</span>
                    </>
                  )}
                  {!currentWorkspace && (
                    <span className="text-slate-400 truncate flex-1">选择或创建工作区</span>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-slate-400 shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">{workspaceCount}</span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => setShowSync(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="从 AI Notebook 同步">
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={handleMigration}
                  disabled={isMigrating}
                  className="p-1 rounded hover:bg-amber-200 text-amber-700 disabled:opacity-50"
                  title={isMigrating ? '重建中...' : '清空并快速重建所有的行业和挂载结构'}
                >
                  <Database size={14} />
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
