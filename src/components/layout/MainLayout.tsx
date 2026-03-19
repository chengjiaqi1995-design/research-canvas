import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { Header } from './Header.tsx';
import { FloatingFileTree } from './FloatingFileTree.tsx';

interface MainLayoutProps {
  children: ReactNode;
}

export const MainLayout = memo(function MainLayout({ children }: MainLayoutProps) {
  const [fileTreeOpen, setFileTreeOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <Header onToggleFileTree={() => setFileTreeOpen((p) => !p)} />
      <div className="flex-1 relative overflow-hidden">
        {children}
        {/* Floating file tree */}
        <FloatingFileTree open={fileTreeOpen} onClose={() => setFileTreeOpen(false)} />
      </div>
    </div>
  );
});
