import { memo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Node } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useAutoSave } from '../../hooks/useAutoSave.ts';
import { useCanvas } from '../../hooks/useCanvas.ts';
import { generateId } from '../../utils/id.ts';
import { TextNode } from '../nodes/TextNode.tsx';
import { TableNode } from '../nodes/TableNode.tsx';
import { CanvasToolbar } from './CanvasToolbar.tsx';

const nodeTypes = {
  text: TextNode,
  table: TableNode,
};

function CanvasInner() {
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onViewportChange = useCanvasStore((s) => s.onViewportChange);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const saveCanvas = useCanvasStore((s) => s.saveCanvas);

  const selectNode = useCanvasStore((s) => s.selectNode);

  const { addTextNode, addTableNode } = useCanvas();

  // Auto-save hook
  useAutoSave();

  // Load canvas when currentCanvasId changes
  useEffect(() => {
    if (currentCanvasId) {
      // Save current canvas before switching
      saveCanvas();
      loadCanvas(currentCanvasId);
    }
  }, [currentCanvasId, loadCanvas, saveCanvas]);

  const onConnect = useCallback(
    (connection: Connection) => {
      addEdge({
        id: generateId(),
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      });
    },
    [addEdge]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '1') {
          e.preventDefault();
          addTextNode({ x: 200, y: 200 });
        } else if (e.key === '2') {
          e.preventDefault();
          addTableNode({ x: 200, y: 200 });
        } else if (e.key === 's') {
          e.preventDefault();
          saveCanvas();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addTextNode, addTableNode, saveCanvas]);

  if (!currentCanvasId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <div className="text-center">
          <p className="text-lg mb-2">选择或创建一个画布开始</p>
          <p className="text-sm">从左侧栏选择工作区，然后选择或创建画布</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <CanvasToolbar />
      <ReactFlow
        nodes={nodes as any}
        edges={edges as any}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_event: React.MouseEvent, node: Node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        onMoveEnd={(_event, vp) => onViewportChange(vp)}
        defaultViewport={viewport}
        fitView={nodes.length > 0}
        snapToGrid
        snapGrid={[16, 16]}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        panOnDrag
        selectionOnDrag={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e2e8f0" />
        <MiniMap
          position="bottom-right"
          style={{ width: 150, height: 100 }}
          maskColor="rgba(0,0,0,0.08)"
        />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export const CanvasView = memo(function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
});
