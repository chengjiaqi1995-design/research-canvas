import { memo, useState, useRef, useEffect } from 'react';
import { LogOut, User, Settings, Sparkles, LayoutDashboard, Cpu, Briefcase, Activity, Loader2, Cloud, Rss, Menu } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { AISettingsModal } from '../ai/AISettingsModal.tsx';
import { ActivityMonitorModal } from '../admin/ActivityMonitorModal.tsx';
import { useMobile } from '../../hooks/useMobile.ts';

interface HeaderProps {
  onMenuClick?: () => void;
}

export const Header = memo(function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isMobile = useMobile();

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

  const viewButtons = [
    { key: 'canvas', icon: LayoutDashboard, label: 'Canvas' },
    { key: 'ai_research', icon: Sparkles, label: 'AI 卡片' },
    { key: 'ai_process', icon: Cpu, label: 'AI Process' },
    { key: 'portfolio', icon: Briefcase, label: 'Portfolio' },
    { key: 'tracker', icon: Activity, label: '行业看板' },
    { key: 'feed', icon: Rss, label: '信息流' },
  ] as const;

  return (
    <>
      <div className="flex items-center justify-between h-10 px-2 md:px-4 border-b border-slate-200 bg-white">
        {/* Left: hamburger (mobile) or saving indicator */}
        <div className="flex items-center gap-2 text-sm min-w-0 shrink-0">
          {isMobile && onMenuClick && (
            <button
              onClick={onMenuClick}
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
              title="打开侧栏"
            >
              <Menu size={18} />
            </button>
          )}
          {!isMobile && (
            <div className="w-[150px]">
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
          )}
        </div>

        {/* Center: View mode toggle — 手机时可横向滚动 */}
        <div className={`flex items-center bg-slate-100 rounded-md p-0.5 ${isMobile ? 'overflow-x-auto no-scrollbar mx-1 flex-1' : ''}`}>
          {viewButtons.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              className={`flex items-center gap-1 px-2 md:px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap shrink-0 ${
                viewMode === key
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={13} />
              {isMobile ? undefined : label}
            </button>
          ))}
        </div>

        {/* Right: Settings + User */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          {/* Activity / Monitor button — 手机隐藏 */}
          {!isMobile && (
            <button
              onClick={() => setShowActivity(true)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="活动监控"
            >
              <Activity size={16} />
            </button>
          )}

          {/* Settings button */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="AI 设置"
          >
            <Settings size={16} />
          </button>

          {/* User avatar & menu */}
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors"
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
