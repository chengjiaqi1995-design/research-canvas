import { useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { SplitWorkspace } from './components/layout/SplitWorkspace.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { useWorkspaceStore } from './stores/workspaceStore.ts';
import { useAuthStore } from './stores/authStore.ts';
import { seedIfEmpty } from './db/seed.ts';
import { CopilotKit } from '@copilotkit/react-core';
import { CopilotPopup } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
import { CopilotActions } from './components/ai/CopilotActions.tsx';

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
      try {
        await seedIfEmpty();
        await loadWorkspaces();
      } catch (err) {
        console.error('Init failed:', err);
      }
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
    <CopilotKit runtimeUrl="/api/copilot">
      <CopilotActions />
      <MainLayout>
        <SplitWorkspace />
      </MainLayout>
      <CopilotPopup
        labels={{
          title: "AI 助理",
          initial: "你好！我是你的 AI 助理，可以帮你管理文件夹、创建笔记等。试试说「帮我创建一个叫 XX 的文件夹」",
        }}
        defaultOpen={false}
      />
    </CopilotKit>
  );
}

export default App;
