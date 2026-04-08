import { memo, useState, useRef, useEffect } from 'react';
import { LogOut, User, Settings, Sparkles, LayoutDashboard, Cpu, Briefcase, Activity, Loader2, Cloud, Rss } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { AISettingsModal } from '../ai/AISettingsModal.tsx';
import { ActivityMonitorModal } from '../admin/ActivityMonitorModal.tsx';

export const Header = memo(function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const viewMode = useAICardStore((s) => s.viewMode);
  const setViewMode = useAICardStore((s) => s.setViewMode);

  const isSaving = useCanvasStore((s) => s.isSaving);

  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
        {/* Left: Saving indicator */}
        <div className="flex items-center gap-2 text-sm w-[150px]">
          {isSaving ? (
            <div className="flex items-center gap-1.5 text-xs text-sky-600 bg-sky-50 px-2.5 py-1 rounded-full font-medium shadow-sm transition-all animate-pulse">
              <Loader2 size={12} className="animate-spin" />
              <span>保存中...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 opacity-60">
              <Cloud size={14} />
              <span>已保存</span>
            </div>
          )}
        </div>

        {/* Center: View mode toggle */}
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
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <Sparkles size={13} />
            AI 卡片
          </button>
          <button
            onClick={() => setViewMode('ai_process')}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'ai_process'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <Cpu size={13} />
            AI Process
          </button>
          <button
            onClick={() => setViewMode('portfolio')}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'portfolio'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <Briefcase size={13} />
            Portfolio
          </button>
          <button
            onClick={() => setViewMode('tracker')}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'tracker'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <Activity size={13} />
            行业看板
          </button>
          <button
            onClick={() => setViewMode('feed')}
            className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'feed'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
              }`}
          >
            <Rss size={13} />
            信息流
          </button>
        </div>

        {/* Right: Settings + User */}
        <div className="flex items-center gap-2">
          {/* Activity / Monitor button */}
          <button
            onClick={() => setShowActivity(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="活动监控"
          >
            <Activity size={16} />
          </button>

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
      
      {/* Activity Monitor Modal */}
      <ActivityMonitorModal open={showActivity} onClose={() => setShowActivity(false)} />
    </>
  );
});

