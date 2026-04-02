import { useEffect, lazy, Suspense } from 'react';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { SplitWorkspace } from './components/layout/SplitWorkspace.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { useWorkspaceStore } from './stores/workspaceStore.ts';
import { useAuthStore } from './stores/authStore.ts';
import { seedIfEmpty } from './db/seed.ts';
import { workspaceApi, canvasApi } from './db/apiClient.ts';
import { generateId } from './utils/id.ts';

import '@copilotkit/react-ui/styles.css';

const CopilotKit = lazy(() =>
  import('@copilotkit/react-core').then((m) => ({ default: m.CopilotKit }))
);
const CopilotPopup = lazy(() =>
  import('@copilotkit/react-ui').then((m) => ({ default: m.CopilotPopup }))
);
const CopilotActions = lazy(() =>
  import('./components/ai/CopilotActions.tsx').then((m) => ({ default: m.CopilotActions }))
);

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
    <Suspense fallback={
      <MainLayout>
        <SplitWorkspace />
      </MainLayout>
    }>
      <CopilotKit
        runtimeUrl="/api/copilot"
        headers={(() => {
          const stored = localStorage.getItem('rc_auth_user');
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              const token = parsed._credential || parsed.sessionToken;
              if (token) return { Authorization: `Bearer ${token}` } as Record<string, string>;
            } catch { /* ignore */ }
          }
          return {} as Record<string, string>;
        })()}
      >
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
    </Suspense>
  );
}

export default App;
