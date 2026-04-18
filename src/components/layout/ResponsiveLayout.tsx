import { memo, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { PanelLeft } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile.ts';

interface ResponsiveLayoutProps {
  /** 侧栏内容 */
  sidebar: ReactNode;
  /** 主内容 */
  children: ReactNode;
  /** 桌面侧栏宽度（px），默认 260 */
  sidebarWidth?: number;
  /** 侧栏背景色 class，默认 bg-white */
  sidebarClassName?: string;
  /** 手机端抽屉标题（无障碍），默认 "导航" */
  drawerTitle?: string;
  /** 外部控制抽屉关闭（如点击列表项后） */
  onSidebarItemClick?: () => void;
}

/**
 * 通用响应式两栏布局
 * - 桌面：左侧固定宽度侧栏 + 右侧 flex-1 内容
 * - 手机（<768px）：内容全屏 + 左上角按钮触发 Vaul 底部抽屉
 */
export const ResponsiveLayout = memo(function ResponsiveLayout({
  sidebar,
  children,
  sidebarWidth = 260,
  sidebarClassName = 'bg-white',
  drawerTitle = '导航',
}: ResponsiveLayoutProps) {
  const isMobile = useMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* ─── 手机布局 ─── */
  if (isMobile) {
    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        {/* 浮动侧栏按钮 */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-4 left-4 z-30 flex items-center justify-center w-11 h-11 rounded-full bg-slate-700 text-white shadow-lg active:scale-95 transition-transform"
          title="打开侧栏"
        >
          <PanelLeft size={18} />
        </button>

        {/* 主内容全屏 */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>

        {/* Vaul 底部抽屉 */}
        <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
            <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl max-h-[85vh] bg-white">
              <div className="mx-auto w-12 h-1.5 rounded-full bg-slate-300 mt-3 mb-1 shrink-0" />
              <Drawer.Title className="sr-only">{drawerTitle}</Drawer.Title>
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {sidebar}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </div>
    );
  }

  /* ─── 桌面布局 ─── */
  return (
    <div className="flex w-full h-full overflow-hidden">
      {/* 左侧栏 */}
      <div
        className={`shrink-0 border-r border-slate-200 flex flex-col h-full overflow-hidden ${sidebarClassName}`}
        style={{ width: sidebarWidth }}
      >
        {sidebar}
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
});
