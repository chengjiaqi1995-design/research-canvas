import { useEffect } from 'react';
import { MainLayout } from './components/layout/MainLayout.tsx';
import { SplitWorkspace } from './components/layout/SplitWorkspace.tsx';
import { useWorkspaceStore } from './stores/workspaceStore.ts';
import { seedIfEmpty } from './db/seed.ts';

function App() {
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);

  useEffect(() => {
    async function init() {
      await seedIfEmpty();
      await loadWorkspaces();
    }
    init();
  }, [loadWorkspaces]);

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

  return (
    <MainLayout>
      <SplitWorkspace />
    </MainLayout>
  );
}

export default App;
