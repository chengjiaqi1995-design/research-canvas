import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';

interface MainLayoutProps {
  children: ReactNode;
}

export const MainLayout = memo(function MainLayout({ children }: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="flex flex-col flex-1 min-w-0">
        <Header />
        <div className="flex-1 relative overflow-hidden">{children}</div>
      </div>
    </div>
  );
});
