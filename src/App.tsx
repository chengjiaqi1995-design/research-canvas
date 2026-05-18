import { useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { SplitWorkspace } from './components/layout/SplitWorkspace.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { useWorkspaceStore } from './stores/workspaceStore.ts';
import { useCanvasStore } from './stores/canvasStore.ts';
import { useAuthStore } from './stores/authStore.ts';
import { useAICardStore } from './stores/aiCardStore.ts';
import { aiApi } from './db/apiClient.ts';
import { getApiConfig } from './aiprocess/components/ApiConfigModal.tsx';
import { OPEN_CANVAS_TARGET_EVENT, type CanvasDeepLinkTarget } from './utils/canvasDeepLink.ts';

function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const readOnly = useAuthStore((s) => s.user?.readOnly === true);
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
        await loadWorkspaces();
      } catch (err) {
        console.error('Init failed:', err);
      }
    }
    init();

    // Fire-and-forget: sync cloud settings → localStorage on startup.
    // Read-only sessions never reveal or sync API keys into the browser.
    if (readOnly) return;
    aiApi.getSettings({ revealKeys: true })
      .then((settings) => {
        const local = getApiConfig();
        const cloud = settings.apiConfig || {};
        const cloudKeys = settings.keys || {};
        // 如果本地 key 为空或是 **** 掩码，就用云端的
        const useCloudIfLocalEmpty = (localVal: string | undefined, cloudVal: string | undefined) => {
          if (!localVal || localVal.includes('****')) return cloudVal || localVal || '';
          return localVal;
        };
        const merged = {
          ...local,
          // ── API keys: 云端 keys.{provider} → 本地 {provider}ApiKey
          geminiApiKey: useCloudIfLocalEmpty(local.geminiApiKey, cloudKeys.google),
          qwenApiKey: useCloudIfLocalEmpty(local.qwenApiKey, cloudKeys.dashscope),
          // ── 模型选择：云端优先
          transcriptionModel: cloud.transcriptionModel || local.transcriptionModel,
          summaryModel: cloud.summaryModel || local.summaryModel,
          metadataModel: cloud.metadataModel || local.metadataModel,
          weeklySummaryModel: cloud.weeklySummaryModel || local.weeklySummaryModel,
          mergeSkillModel: cloud.mergeSkillModel || local.mergeSkillModel,
          assistantFastModel: cloud.assistantFastModel || local.assistantFastModel,
          assistantDeepModel: cloud.assistantDeepModel || local.assistantDeepModel,
          translationModel: cloud.translationModel || local.translationModel,
          namingModel: cloud.namingModel || local.namingModel,
          metadataFillModel: cloud.metadataFillModel || local.metadataFillModel,
          excelParsingModel: cloud.excelParsingModel || local.excelParsingModel,
          wikiModel: cloud.wikiModel || local.wikiModel,
          wikiIngestPrompt: cloud.wikiIngestPrompt || local.wikiIngestPrompt,
          autoTrackerSniffing: cloud.autoTrackerSniffing ?? local.autoTrackerSniffing,
        };
        localStorage.setItem('apiConfig', JSON.stringify(merged));
        window.dispatchEvent(new Event('apiConfigUpdated'));
        console.log('☁️ Startup: cloud settings synced to localStorage (keys + apiConfig)');
      })
      .catch(() => { /* non-critical */ });
  }, [isAuthenticated, loadWorkspaces, readOnly]);

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

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleOpenCanvasTarget = (event: Event) => {
      const target = (event as CustomEvent<CanvasDeepLinkTarget>).detail;
      if (!target?.canvasId) return;

      void (async () => {
        try {
          useAICardStore.getState().setViewMode('canvas');

          if (target.workspaceId) {
            const workspaceState = useWorkspaceStore.getState();
            if (!workspaceState.workspaces.some((w) => w.id === target.workspaceId)) {
              await workspaceState.loadWorkspaces();
            }
            useWorkspaceStore.getState().setCurrentWorkspace(target.workspaceId);
            await useWorkspaceStore.getState().loadCanvases(target.workspaceId);
          }

          useWorkspaceStore.getState().setCurrentCanvas(target.canvasId);
          await useCanvasStore.getState().loadCanvas(target.canvasId);

          if (target.nodeId) {
            window.setTimeout(() => {
              useCanvasStore.getState().selectNode(target.nodeId || null);
            }, 80);
          }
        } catch (err) {
          console.error('Open canvas target failed:', err);
        }
      })();
    };

    window.addEventListener(OPEN_CANVAS_TARGET_EVENT, handleOpenCanvasTarget as EventListener);
    return () => {
      window.removeEventListener(OPEN_CANVAS_TARGET_EVENT, handleOpenCanvasTarget as EventListener);
    };
  }, [isAuthenticated]);

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
