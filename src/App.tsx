import { useEffect, Suspense } from 'react';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { SplitWorkspace } from './components/layout/SplitWorkspace.tsx';
import { LoginPage } from './components/auth/LoginPage.tsx';
import { useWorkspaceStore } from './stores/workspaceStore.ts';
import { useAuthStore } from './stores/authStore.ts';
import { seedIfEmpty } from './db/seed.ts';
import { workspaceApi, canvasApi, aiApi } from './db/apiClient.ts';
import { generateId } from './utils/id.ts';
import { lazyWithRetry } from './utils/lazyWithRetry.ts';
import { getApiConfig } from './aiprocess/components/ApiConfigModal.tsx';

import '@copilotkit/react-ui/styles.css';

const CopilotKit = lazyWithRetry(() =>
  import('@copilotkit/react-core').then((m) => ({ default: m.CopilotKit })), 'CopilotKit'
);
const CopilotPopup = lazyWithRetry(() =>
  import('@copilotkit/react-ui').then((m) => ({ default: m.CopilotPopup })), 'CopilotPopup'
);
const CopilotActions = lazyWithRetry(() =>
  import('./components/ai/CopilotActions.tsx').then((m) => ({ default: m.CopilotActions })), 'CopilotActions'
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

    // Fire-and-forget: sync cloud settings → localStorage on startup
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
          const h: Record<string, string> = {};
          const stored = localStorage.getItem('rc_auth_user');
          if (stored) {
            try {
              const parsed = JSON.parse(stored);
              const token = parsed._credential || parsed.sessionToken;
              if (token) h['Authorization'] = `Bearer ${token}`;
            } catch { /* ignore */ }
          }
          // 把用户设置的模型传给 CopilotKit 后端
          try {
            const cfg = JSON.parse(localStorage.getItem('apiConfig') || '{}');
            if (cfg.summaryModel) h['x-ai-model'] = cfg.summaryModel;
          } catch { /* ignore */ }
          return h;
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
