import { memo, useState, useRef, useEffect } from 'react';
import { LogOut, User, Settings, FlaskConical, LayoutDashboard } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useAuthStore } from '../../stores/authStore.ts';
import { useAIResearchStore } from '../../stores/aiResearchStore.ts';
import { AISettingsModal } from '../ai/AISettingsModal.tsx';

export const Header = memo(function Header() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const viewMode = useAIResearchStore((s) => s.viewMode);
  const setViewMode = useAIResearchStore((s) => s.setViewMode);

  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);
  const currentCanvas = canvases.find((c) => c.id === currentCanvasId);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  return (
    <>
      <div className="flex items-center justify-between h-10 px-4 border-b border-slate-200 bg-white">
        {/* Left: Breadcrumb */}
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

        {/* Center: View mode toggle */}
        {currentCanvasId && (
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('canvas')}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'canvas'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              <LayoutDashboard size={13} />
              Canvas
            </button>
            <button
              onClick={() => setViewMode('ai_research')}
              className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'ai_research'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              <FlaskConical size={13} />
              AI 研究
            </button>
          </div>
        )}

        {/* Right: Settings + User */}
        <div className="flex items-center gap-2">
          {/* Settings button */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="AI 设置"
          >
            <Settings size={16} />
          </button>

          {/* User avatar & menu */}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="w-6 h-6 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <User size={16} className="text-slate-500" />
                )}
                <span className="text-xs text-slate-600 max-w-[120px] truncate hidden sm:inline">
                  {user.name}
                </span>
              </button>

              {showMenu && (
                <div className="absolute right-0 top-9 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-1">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-800 truncate">{user.name}</p>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      logout();
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={14} />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Settings modal */}
      <AISettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
});

