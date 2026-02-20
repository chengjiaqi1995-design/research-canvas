import { memo, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';

interface MainLayoutProps {
  children: ReactNode;
}

export const MainLayout = memo(function MainLayout({ children }: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const startXRef = useRef(0);
  const startWidthRef = useRef(256);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startXRef.current;
      const newWidth = Math.max(180, Math.min(600, startWidthRef.current + delta));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        width={sidebarWidth}
      />
      {/* Resize handle */}
      {!sidebarCollapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="w-1 hover:bg-blue-400 cursor-col-resize shrink-0 transition-colors relative"
          style={{ marginLeft: '-1px' }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 rounded bg-slate-400 opacity-0 hover:opacity-40" />
        </div>
      )}
      <div className="flex flex-col flex-1 min-w-0">
        <Header />
        <div className="flex-1 relative overflow-hidden">{children}</div>
      </div>
    </div>
  );
});
