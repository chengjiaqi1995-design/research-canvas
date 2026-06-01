import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange } from '@xyflow/react';
import { canvasApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import { createMainTextNode, withNodeTimestamps } from '../canvas/canvasNodeFactory.ts';
import { normalizeLoadedCanvas } from '../canvas/canvasLoadNormalizer.ts';
import { createCanvasSaveQueue } from '../canvas/canvasSaveQueue.ts';
import type { CanvasViewport } from '../canvas/canvasLoadNormalizer.ts';
import type { CanvasNode, CanvasEdge, NodeData, CellValue, ModuleConfig, CanvasAttachmentReference } from '../types/index.ts';

interface CanvasState {
  // Current canvas data
  currentCanvasId: string | null;
  modules: ModuleConfig[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  updatedAt: number;

  // Selected node for detail panel
  selectedNodeId: string | null;
  activeAttachmentReference: CanvasAttachmentReference | null;

  // Dirty flag for auto-save
  isDirty: boolean;
  isSaving: boolean;

  // Actions
  loadCanvas: (canvasId: string) => Promise<void>;
  saveCanvas: () => Promise<void>;
  selectNode: (nodeId: string | null) => void;
  openAttachmentReference: (reference: CanvasAttachmentReference) => void;
  clearActiveAttachmentReference: () => void;

  // Module operations
  addModule: (name: string) => void;
  removeModule: (moduleId: string) => void;
  renameModule: (moduleId: string, name: string) => void;
  toggleModuleCollapse: (moduleId: string) => void;
  reorderModules: (fromIndex: number, toIndex: number) => void;

  // Node operations
  addNode: (node: CanvasNode) => void;
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void;
  removeNode: (nodeId: string) => void;
  deleteNodeAndSave: (nodeId: string) => Promise<void>;
  updateCellValue: (nodeId: string, rowId: string, colId: string, value: CellValue) => void;

  // AI Card operations
  appendAICardContent: (nodeId: string, chunk: string) => void;
  setAICardStreaming: (nodeId: string, streaming: boolean) => void;

  // Edge operations
  addEdge: (edge: CanvasEdge) => void;
  removeEdge: (edgeId: string) => void;

  // React Flow callbacks
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onViewportChange: (viewport: CanvasViewport) => void;
}

export const useCanvasStore = create<CanvasState>()(
  immer((set, get) => {
    const saveQueue = createCanvasSaveQueue({
      onSaved: (task, updatedAt) => {
        if (get().currentCanvasId === task.canvasId) {
          set((state) => {
            state.updatedAt = updatedAt;
          });
        }
      },
      onFailed: (task, error) => {
        console.error('Save canvas failed:', error);
        if (get().currentCanvasId === task.canvasId) {
          set((state) => {
            state.isDirty = true;
          });
        }
      },
      onDrained: () => {
        set((state) => {
          state.isSaving = false;
        });
      },
    });

    return {
    currentCanvasId: null,
    modules: [],
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: 0,
    selectedNodeId: null,
    activeAttachmentReference: null,
    isDirty: false,
    isSaving: false,

    loadCanvas: async (canvasId: string) => {
      // Save current canvas before switching
      const { isDirty, currentCanvasId } = get();
      if (isDirty && currentCanvasId) {
        await get().saveCanvas(); // wait for save to complete before switching
      }

      let canvas;
      try {
        canvas = await canvasApi.get(canvasId);
      } catch {
        return;
      }
      if (!canvas) return;

      const normalizedCanvas = normalizeLoadedCanvas(canvas);

      set((state) => {
        state.currentCanvasId = canvasId;
        state.modules = normalizedCanvas.modules;
        state.nodes = normalizedCanvas.nodes;
        state.edges = normalizedCanvas.edges;
        state.viewport = normalizedCanvas.viewport;
        state.updatedAt = normalizedCanvas.updatedAt;
        state.selectedNodeId = null;
        state.activeAttachmentReference = null;
        state.isDirty = normalizedCanvas.needsSave;
      });
    },

    saveCanvas: async () => {
      const { currentCanvasId, modules, nodes, edges, viewport, isDirty } = get();
      if (!currentCanvasId || !isDirty) return;

      const taskSnapshot = {
        canvasId: currentCanvasId,
        modules,
        nodes,
        edges,
        viewport,
        updatedAt: Date.now(),
      };

      // Optimistically clear dirty flag and show saving progress
      set((state) => {
        state.isDirty = false;
        state.isSaving = true;
      });

      return saveQueue.enqueue(taskSnapshot);
    },

    selectNode: (nodeId) => {
      set((state) => {
        state.selectedNodeId = nodeId;
      });
    },

    openAttachmentReference: (reference) => {
      set((state) => {
        state.selectedNodeId = reference.sourceNodeId;
        state.activeAttachmentReference = reference;
      });
    },

    clearActiveAttachmentReference: () => {
      set((state) => {
        state.activeAttachmentReference = null;
      });
    },

    // === Module operations ===

    addModule: (name) => {
      set((state) => {
        const maxOrder = state.modules.reduce((max, m) => Math.max(max, m.order), -1);
        const newModule: ModuleConfig = {
          id: generateId(),
          name,
          order: maxOrder + 1,
        };
        state.modules.push(newModule);

        state.nodes.push(createMainTextNode(newModule));
        state.isDirty = true;
      });
    },

    removeModule: (moduleId) => {
      set((state) => {
        state.modules = state.modules.filter((m) => m.id !== moduleId);
        // Remove all nodes associated with this module
        const removedNodeIds = new Set(
          (state.nodes || []).filter((n) => n.module === moduleId).map((n) => n.id)
        );
        state.nodes = (state.nodes || []).filter((n) => n.module !== moduleId);
        state.edges = (state.edges || []).filter(
          (e) => !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target)
        );
        if (state.selectedNodeId && removedNodeIds.has(state.selectedNodeId)) {
          state.selectedNodeId = null;
        }
        state.isDirty = true;
      });
    },

    renameModule: (moduleId, name) => {
      set((state) => {
        const mod = state.modules.find((m) => m.id === moduleId);
        if (mod) {
          mod.name = name;
          state.isDirty = true;
        }
      });
    },

    toggleModuleCollapse: (moduleId) => {
      set((state) => {
        const mod = state.modules.find((m) => m.id === moduleId);
        if (mod) {
          mod.collapsed = !mod.collapsed;
          state.isDirty = true;
        }
      });
    },

    reorderModules: (fromIndex, toIndex) => {
      set((state) => {
        // Work with a sorted copy
        const sorted = [...state.modules].sort((a, b) => a.order - b.order);
        const [moved] = sorted.splice(fromIndex, 1);
        sorted.splice(toIndex, 0, moved);
        // Reassign order values
        sorted.forEach((m, i) => {
          m.order = i;
        });
        state.modules = sorted;
        state.isDirty = true;
      });
    },

    // === Node operations ===

    addNode: (node) => {
      set((state) => {
        state.nodes.push(withNodeTimestamps(node));
        state.isDirty = true;
      });
    },

    updateNodeData: (nodeId, data) => {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId);
        if (node) {
          node.data = { ...node.data, ...data, updatedAt: Date.now() } as NodeData;
          state.isDirty = true;
        }
      });
    },

    removeNode: (nodeId) => {
      set((state) => {
        state.nodes = (state.nodes || []).filter((n) => n.id !== nodeId);
        state.edges = (state.edges || []).filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        );
        if (state.selectedNodeId === nodeId) {
          state.selectedNodeId = null;
        }
        state.isDirty = true;
      });
    },

    deleteNodeAndSave: async (nodeId) => {
      await saveQueue.whenIdle();
      if (get().isDirty) {
        await get().saveCanvas();
      }

      const snapshot = get();
      if (!snapshot.currentCanvasId) return;
      if (!(snapshot.nodes || []).some((n) => n.id === nodeId)) return;

      const nextNodes = (snapshot.nodes || []).filter((n) => n.id !== nodeId);
      const nextEdges = (snapshot.edges || []).filter((e) => e.source !== nodeId && e.target !== nodeId);

      set((state) => {
        state.isSaving = true;
      });

      let result: { updatedAt?: number };
      try {
        result = await canvasApi.trashNode(snapshot.currentCanvasId, nodeId);
      } catch (err) {
        set((state) => {
          state.isSaving = false;
        });
        throw err;
      }

      const updatedAt = result.updatedAt || Date.now();
      set((state) => {
        if (state.currentCanvasId === snapshot.currentCanvasId) {
          state.nodes = nextNodes;
          state.edges = nextEdges;
          if (state.selectedNodeId === nodeId) {
            state.selectedNodeId = null;
          }
          state.updatedAt = updatedAt;
        }
        state.isSaving = false;
      });
    },

    updateCellValue: (nodeId, rowId, colId, value) => {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId);
        if (node && node.data.type === 'table') {
          const row = node.data.rows.find((r) => r.id === rowId);
          if (row) {
            row.cells[colId] = value;
            state.isDirty = true;
          }
        }
      });
    },

    // === AI Card operations ===

    appendAICardContent: (nodeId, chunk) => {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId);
        if (node && node.data.type === 'ai_card') {
          node.data.generatedContent += chunk;
          node.data.editedContent = node.data.generatedContent;
          state.isDirty = true;
        }
      });
    },

    setAICardStreaming: (nodeId, streaming) => {
      set((state) => {
        const node = state.nodes.find((n) => n.id === nodeId);
        if (node && node.data.type === 'ai_card') {
          node.data.isStreaming = streaming;
          if (!streaming) {
            node.data.lastGeneratedAt = Date.now();
          }
          state.isDirty = true;
        }
      });
    },

    // === Edge operations ===

    addEdge: (edge) => {
      set((state) => {
        const exists = state.edges.some(
          (e) => e.source === edge.source && e.target === edge.target
        );
        if (!exists) {
          state.edges.push({ ...edge, id: edge.id || generateId() });
          state.isDirty = true;
        }
      });
    },

    removeEdge: (edgeId) => {
      set((state) => {
        state.edges = (state.edges || []).filter((e) => e.id !== edgeId);
        state.isDirty = true;
      });
    },

    onNodesChange: (changes) => {
      set((state) => {
        state.nodes = applyNodeChanges(changes, state.nodes as any) as any;
        state.isDirty = true;
      });
    },

    onEdgesChange: (changes) => {
      set((state) => {
        state.edges = applyEdgeChanges(changes, state.edges as any) as any;
        state.isDirty = true;
      });
    },

    onViewportChange: (viewport) => {
      set((state) => {
        if (
          state.viewport.x === viewport.x
          && state.viewport.y === viewport.y
          && state.viewport.zoom === viewport.zoom
        ) {
          return;
        }
        state.viewport = viewport;
        state.isDirty = true;
      });
    },
  };
  })
);
