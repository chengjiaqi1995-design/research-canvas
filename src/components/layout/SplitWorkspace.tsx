import { memo, useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { ModuleColumn } from './ModuleColumn.tsx';
import { lazyWithRetry } from '../../utils/lazyWithRetry.ts';

const DetailPanel = lazyWithRetry(() => import('../detail/DetailPanel.tsx').then(m => ({ default: m.DetailPanel })), 'DetailPanel');
const AICardsView = lazyWithRetry(() => import('../ai/AICardsView.tsx').then(m => ({ default: m.AICardsView })), 'AICardsView');
const AIProcessView = lazyWithRetry(() => import('../aiprocess/AIProcessView.tsx').then(m => ({ default: m.AIProcessView })), 'AIProcessView');
const PortfolioView = lazyWithRetry(() => import('../portfolio/PortfolioView.tsx').then(m => ({ default: m.PortfolioView })), 'PortfolioView');
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { useAutoSave } from '../../hooks/useAutoSave.ts';

/** Draggable resize handle */
function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const startXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        startXRef.current = ev.clientX;
        onDrag(delta);
      };
      const handleMouseUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [onDrag]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 bg-slate-200 hover:bg-blue-400 cursor-col-resize shrink-0 transition-colors relative"
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 rounded bg-slate-400 opacity-40" />
    </div>
  );
}

export const SplitWorkspace = memo(function SplitWorkspace() {
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const viewMode = useAICardStore((s) => s.viewMode);

  useAutoSave();

  useEffect(() => {
    if (currentCanvasId) {
      loadCanvas(currentCanvasId);
    }
  }, [currentCanvasId, loadCanvas]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Module column width as fraction (when detail panel is open)
  const [moduleWidth, setModuleWidth] = useState(0.55);

  const panelOpen = selectedNodeId !== null;

  const handleResize = useCallback(
    (deltaX: number) => {
      if (!containerRef.current) return;
      const totalW = containerRef.current.getBoundingClientRect().width;
      const delta = deltaX / totalW;
      setModuleWidth((prev) => Math.max(0.3, Math.min(0.7, prev + delta)));
    },
    []
  );

  // AI Process mode — works without a canvas selected
  if (viewMode === 'ai_process') {
    return (
      <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载 AI 工作流...</div>}>
        <AIProcessView />
      </Suspense>
    );
  }

  // Portfolio mode (independent of canvas selection)
  if (viewMode === 'portfolio') {
    return (
      <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载研究统计大屏...</div>}>
        <PortfolioView />
      </Suspense>
    );
  }

  if (!currentCanvasId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <div className="text-center">
          <p className="text-sm mb-1">选择或创建一个画布开始</p>
          <p className="text-xs">从左侧栏选择工作区，然后选择或创建画布</p>
        </div>
      </div>
    );
  }

  // AI Research mode
  if (viewMode === 'ai_research') {
    return (
      <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm">正在加载 AI 助手研究台...</div>}>
        <AICardsView />
      </Suspense>
    );
  }

  const detailWidth = panelOpen ? 1 - moduleWidth : 0;
  const actualModuleWidth = panelOpen ? moduleWidth : 1;

  return (
    <div ref={containerRef} className="flex w-full h-full overflow-hidden">
      {/* Module column (with inline file lists) */}
      <div
        style={{ width: `${actualModuleWidth * 100}%` }}
        className="h-full overflow-hidden border-r border-slate-200"
      >
        <ModuleColumn />
      </div>

      {/* Detail panel */}
      {panelOpen && (
        <>
          <ResizeHandle onDrag={handleResize} />
          <div
            style={{ width: `${detailWidth * 100}%` }}
            className="h-full overflow-hidden"
          >
            <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 text-sm bg-slate-50">正在加载模块编辑器...</div>}>
              <DetailPanel />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
});

