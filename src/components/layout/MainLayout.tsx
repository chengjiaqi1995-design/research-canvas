import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { Header } from './Header.tsx';
import { FolderColumn } from './FolderColumn.tsx';
import { FileListColumn } from './FileListColumn.tsx';

interface MainLayoutProps {
  children: ReactNode;
}

export const MainLayout = memo(function MainLayout({ children }: MainLayoutProps) {
  const [folderCollapsed, setFolderCollapsed] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {/* Column 1: Folders */}
        <FolderColumn
          collapsed={folderCollapsed}
          onToggle={() => setFolderCollapsed((p) => !p)}
        />
        {/* Column 2: Files/Canvases in selected folder */}
        <FileListColumn />
        {/* Column 3+: Main content area */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
});
