import { memo, useState, useEffect, Suspense, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Drawer } from 'vaul';
import { ModuleColumn } from './ModuleColumn.tsx';
import { lazyWithRetry } from '../../utils/lazyWithRetry.ts';
import { useMobile } from '../../hooks/useMobile.ts';

const DetailPanel = lazyWithRetry(() => import('../detail/DetailPanel.tsx').then(m => ({ default: m.DetailPanel })), 'DetailPanel');
const AICardsView = lazyWithRetry(() => import('../ai/AICardsView.tsx').then(m => ({ default: m.AICardsView })), 'AICardsView');
const AIProcessView = lazyWithRetry(() => import('../aiprocess/AIProcessView.tsx').then(m => ({ default: m.AIProcessView })), 'AIProcessView');
const PortfolioView = lazyWithRetry(() => import('../portfolio/PortfolioView.tsx').then(m => ({ default: m.PortfolioView })), 'PortfolioView');
const TrackerView = lazyWithRetry(() => import('../tracker/TrackerView.tsx').then(m => ({ default: m.TrackerView })), 'TrackerView');
const FeedView = lazyWithRetry(() => import('../feed/FeedView.tsx').then(m => ({ default: m.FeedView })), 'FeedView');
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { useAutoSave } from '../../hooks/useAutoSave.ts';
import { canvasApi } from '../../db/apiClient.ts';

export const SplitWorkspace = memo(function SplitWorkspace() {
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const viewMode = useAICardStore((s) => s.viewMode);
  const isMobile = useMobile();

  useAutoSave();

  useEffect(() => {
    if (currentCanvasId) {
      loadCanvas(currentCanvasId);
    }
    useAICardStore.getState().syncWithServer();
    useAICardStore.getState().loadModels();
  }, [currentCanvasId, loadCanvas]);

  const panelOpen = selectedNodeId !== null;

  // KeepAlive Tracking
  const [visitedViews, setVisitedViews] = useState<Set<string>>(new Set([viewMode]));
  useEffect(() => {
    setVisitedViews(prev => {
      if (prev.has(viewMode)) return prev;
      const next = new Set(prev);
      next.add(viewMode);
      return next;
    });
  }, [viewMode]);

  // Wake-up Probe for Canvas multi-device protection
  const prevViewMode = useRef(viewMode);
  useEffect(() => {
    if (prevViewMode.current !== 'canvas' && viewMode === 'canvas' && currentCanvasId) {
      async function wakeUpProbe(cid: string) {
        try {
          const fresh = await canvasApi.get(cid);
          const localUpdatedAt = useCanvasStore.getState().updatedAt;
          if (fresh && fresh.updatedAt && fresh.updatedAt > localUpdatedAt) {
            console.log('Wake-up probe: Local canvas is stale. Forcing reload...', localUpdatedAt, fresh.updatedAt);
            await loadCanvas(cid);
          }
        } catch (err) {
          // ignore
        }
      }
      wakeUpProbe(currentCanvasId);
    }
    prevViewMode.current = viewMode;
  }, [viewMode, currentCanvasId, loadCanvas]);

  /** 全屏覆盖视图（AI Process, Portfolio 等） */
  const overlayViews = (
    <>
      {visitedViews.has('ai_process') && (
        <div className="absolute inset-0 z-10 bg-white" style={{ display: viewMode === 'ai_process' ? 'block' : 'none' }}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载 AI 工作流...</div>}>
            <AIProcessView />
          </Suspense>
        </div>
      )}
      {visitedViews.has('portfolio') && (
        <div className="absolute inset-0 z-10 bg-slate-50" style={{ display: viewMode === 'portfolio' ? 'block' : 'none' }}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载研究统计大屏...</div>}>
            <PortfolioView />
          </Suspense>
        </div>
      )}
      {visitedViews.has('tracker') && (
        <div className="absolute inset-0 z-10 bg-slate-50" style={{ display: viewMode === 'tracker' ? 'block' : 'none' }}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载行业追踪看板...</div>}>
            <TrackerView />
          </Suspense>
        </div>
      )}
      {visitedViews.has('ai_research') && (
        <div className="absolute inset-0 z-10 bg-slate-50" style={{ display: viewMode === 'ai_research' ? 'block' : 'none' }}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载 AI 助手研究台...</div>}>
            <AICardsView />
          </Suspense>
        </div>
      )}
      {visitedViews.has('feed') && (
        <div className="absolute inset-0 z-10 bg-slate-50" style={{ display: viewMode === 'feed' ? 'block' : 'none' }}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载信息流...</div>}>
            <FeedView />
          </Suspense>
        </div>
      )}
    </>
  );

  /** Canvas 空状态 */
  const emptyState = viewMode === 'canvas' && !currentCanvasId && (
    <div className="absolute inset-0 z-10 bg-slate-50 flex items-center justify-center text-slate-400">
      <div className="text-center">
        <p className="text-sm mb-1">选择或创建一个画布开始</p>
        <p className="text-xs">从左侧栏选择工作区，然后选择或创建画布</p>
      </div>
    </div>
  );

  /* ─── 手机布局 ─── */
  if (isMobile) {
    return (
      <div className="flex w-full h-full overflow-hidden relative bg-white">
        {overlayViews}
        {emptyState}

        {/* Canvas 视图 — 手机全宽显示 ModuleColumn */}
        {visitedViews.has('canvas') && currentCanvasId && (
          <div className="absolute inset-0 z-0 flex flex-col w-full h-full overflow-hidden" style={{ display: viewMode === 'canvas' ? 'flex' : 'none' }}>
            <div className="flex-1 overflow-hidden">
              <ModuleColumn />
            </div>
          </div>
        )}

        {/* 详情面板：手机上用 Vaul 底部抽屉 */}
        <Drawer.Root
          open={panelOpen}
          onOpenChange={(open) => { if (!open) selectNode(null); }}
        >
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
            <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-white rounded-t-2xl max-h-[90vh]">
              <div className="mx-auto w-12 h-1.5 rounded-full bg-slate-300 mt-3 mb-1 shrink-0" />
              <Drawer.Title className="sr-only">详情</Drawer.Title>
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<div className="flex items-center justify-center h-40 text-slate-400 text-sm">正在加载...</div>}>
                  <DetailPanel />
                </Suspense>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </div>
    );
  }

  /* ─── 桌面布局 ─── */
  return (
    <div className="flex w-full h-full overflow-hidden relative bg-white">
      {overlayViews}
      {emptyState}

      {/* Canvas 视图 — 桌面用 PanelGroup 左右分栏 */}
      {visitedViews.has('canvas') && currentCanvasId && (
        <div className="absolute inset-0 z-0 flex w-full h-full overflow-hidden" style={{ display: viewMode === 'canvas' ? 'flex' : 'none' }}>
          {panelOpen ? (
            <PanelGroup direction="horizontal" autoSaveId="canvas-split">
              <Panel defaultSize={55} minSize={30} maxSize={70}>
                <div className="h-full overflow-hidden border-r border-slate-200">
                  <ModuleColumn />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1 bg-slate-200 hover:bg-blue-400 cursor-col-resize transition-colors relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 rounded bg-slate-400 opacity-40" />
              </PanelResizeHandle>
              <Panel minSize={30}>
                <div className="h-full overflow-hidden">
                  <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm bg-slate-50">正在加载模块编辑器...</div>}>
                    <DetailPanel />
                  </Suspense>
                </div>
              </Panel>
            </PanelGroup>
          ) : (
            <div className="w-full h-full overflow-hidden">
              <ModuleColumn />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
