import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { Header } from './Header.tsx';
import { FolderColumn } from './FolderColumn.tsx';
import { FileListColumn } from './FileListColumn.tsx';

interface MainLayoutProps {
  children: ReactNode;
}

export const MainLayout = memo(function MainLayout({ children }: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {sidebarCollapsed ? (
          /* Collapsed: thin strip with expand button */
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
          <>
            {/* Column 1: Folders + Canvas tree */}
            <FolderColumn
              collapsed={false}
              onToggle={() => setSidebarCollapsed(true)}
            />
            {/* Column 2: Files in selected canvas */}
            <div className="border-r border-slate-200">
              <FileListColumn />
            </div>
          </>
        )}
        {/* Main content area */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
});
