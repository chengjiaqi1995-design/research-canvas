import { useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { SplitWorkspace } from './components/layout/SplitWorkspace.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { useWorkspaceStore } from './stores/workspaceStore.ts';
import { useAuthStore } from './stores/authStore.ts';
import { seedIfEmpty } from './db/seed.ts';

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    async function init() {
      await seedIfEmpty();
      await loadWorkspaces();
    }
    init();
  }, [isAuthenticated, loadWorkspaces]);

  // Auto-select first workspace and canvas
  useEffect(() => {
    if (workspaces.length > 0 && !useWorkspaceStore.getState().currentWorkspaceId) {
      setCurrentWorkspace(workspaces[0].id);
    }
  }, [workspaces, setCurrentWorkspace]);

  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

  useEffect(() => {
    if (canvases.length > 0 && !currentCanvasId) {
      setCurrentCanvas(canvases[0].id);
    }
  }, [canvases, currentCanvasId, setCurrentCanvas]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="login-spinner" />
      </div>
    );
  }

  // Auth gate
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <MainLayout>
      <SplitWorkspace />
    </MainLayout>
  );
}

export default App;
