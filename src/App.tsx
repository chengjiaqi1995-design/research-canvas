import { useEffect, useRef } from 'react';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { SplitWorkspace } from './components/layout/SplitWorkspace.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { useWorkspaceStore } from './stores/workspaceStore.ts';
import { useAuthStore } from './stores/authStore.ts';
import { seedIfEmpty } from './db/seed.ts';

const GOOGLE_CLIENT_ID = '208594497704-4urmpvbdca13v2ae3a0hbkj6odnhu8t1.apps.googleusercontent.com';
const TOKEN_REFRESH_INTERVAL = 50 * 60 * 1000; // 50 minutes

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const login = useAuthStore((s) => s.login);
  const gsiInitialized = useRef(false);

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

  // Silent token refresh: re-initialize GSI and prompt every 50 minutes
  useEffect(() => {
    if (!isAuthenticated) return;

    function initSilentRefresh() {
      if (!window.google?.accounts?.id || gsiInitialized.current) return;
      gsiInitialized.current = true;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response: { credential: string }) => {
          login(response.credential);
        },
        auto_select: true,
      });
    }

    // Wait for GSI script to load, then initialize
    if (window.google?.accounts?.id) {
      initSilentRefresh();
    } else {
      const waitTimer = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(waitTimer);
          initSilentRefresh();
        }
      }, 200);
      setTimeout(() => clearInterval(waitTimer), 5000);
    }

    // Periodically prompt for silent refresh
    const refreshTimer = setInterval(() => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.prompt();
      }
    }, TOKEN_REFRESH_INTERVAL);

    return () => {
      clearInterval(refreshTimer);
      gsiInitialized.current = false;
    };
  }, [isAuthenticated, login]);

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
