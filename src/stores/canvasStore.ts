import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange } from '@xyflow/react';
import { canvasApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { CanvasNode, CanvasEdge, NodeData, CellValue, ModuleConfig } from '../types/index.ts';

/** Default modules for backward compatibility with old data */
const DEFAULT_MODULES: ModuleConfig[] = [
  { id: 'supply_demand', name: '供需', order: 0 },
  { id: 'cost_curve', name: '成本曲线', order: 1 },
  { id: 'money_flow', name: 'Money Flow', order: 2 },
  { id: 'timing', name: 'Timing', order: 3 },
];

let savePromise: Promise<void> | null = null;
let queuedSaveTask: any = null;

async function processSaveQueue(initialTask: any, get: () => CanvasState, set: (fn: (state: CanvasState) => void) => void) {
  let currentTask = initialTask;
  while (currentTask) {
    try {
      const newUpdatedAt = currentTask.updatedAt || Date.now();
      await canvasApi.update(currentTask.canvasId, {
        modules: currentTask.modules,
        nodes: currentTask.nodes,
        edges: currentTask.edges,
        viewport: currentTask.viewport,
        updatedAt: newUpdatedAt,
      });

      const currentState = get();
      if (currentState.currentCanvasId === currentTask.canvasId) {
        set((state) => {
          state.updatedAt = newUpdatedAt;
        });
      }
    } catch (err) {
      console.error('Save canvas failed:', err);
      const currentState = get();
      if (currentState.currentCanvasId === currentTask.canvasId) {
        set((state) => {
          state.isDirty = true;
        });
      }
      break;
    }

    currentTask = queuedSaveTask;
    queuedSaveTask = null;
  }

  set((state) => {
    state.isSaving = false;
  });
  savePromise = null;
}

interface CanvasState {
  // Current canvas data
  currentCanvasId: string | null;
  modules: ModuleConfig[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  updatedAt: number;

  // Selected node for detail panel
  selectedNodeId: string | null;

  // Dirty flag for auto-save
  isDirty: boolean;
  isSaving: boolean;

  // Actions
  loadCanvas: (canvasId: string) => Promise<void>;
  saveCanvas: () => Promise<void>;
  selectNode: (nodeId: string | null) => void;

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
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
}

export const useCanvasStore = create<CanvasState>()(
  immer((set, get) => ({
    currentCanvasId: null,
    modules: [],
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: 0,
    selectedNodeId: null,
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

      // Backward compatibility: if no modules field, infer from nodes
      let modules = canvas.modules;
      const safeNodes = canvas.nodes || [];
      if (!modules || modules.length === 0) {
        const usedModuleIds = new Set(
          safeNodes.map((n: CanvasNode) => n.module).filter(Boolean) as string[]
        );
        if (usedModuleIds.size > 0) {
          modules = DEFAULT_MODULES.filter((m) => usedModuleIds.has(m.id));
        } else {
          modules = [{ id: 'default', name: '默认', order: 0 }];
        }
      }

      // Ensure every module has a main text node
      const nodes = [...safeNodes];
      let needsSave = false;
      for (const mod of modules) {
        const hasMain = nodes.some(
          (n) => n.module === mod.id && n.isMain && n.data.type === 'text'
        );
        if (!hasMain) {
          nodes.push({
            id: generateId(),
            type: 'text',
            position: { x: 0, y: 0 },
            data: { type: 'text', title: mod.name, content: '' },
            module: mod.id,
            isMain: true,
          });
          needsSave = true;
        }
      }

      // Reset any AI cards that were streaming when saved
      for (const node of nodes) {
        if (node.data.type === 'ai_card' && node.data.isStreaming) {
          node.data.isStreaming = false;
        }
      }

      set((state) => {
        state.currentCanvasId = canvasId;
        state.modules = modules;
        state.nodes = nodes;
        state.edges = canvas.edges;
        state.viewport = canvas.viewport;
        state.updatedAt = canvas.updatedAt || Date.now();
        state.selectedNodeId = null;
        state.isDirty = needsSave;
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

      if (savePromise) {
        queuedSaveTask = taskSnapshot;
        return;
      }

      savePromise = processSaveQueue(taskSnapshot, get, set as any);
      return savePromise;
    },

    selectNode: (nodeId) => {
      set((state) => {
        state.selectedNodeId = nodeId;
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

        // Auto-create a main text node for the new module
        const mainNode: CanvasNode = {
          id: generateId(),
          type: 'text',
          position: { x: 0, y: 0 },
          data: { type: 'text', title: name, content: '' },
          module: newModule.id,
          isMain: true,
        };
        state.nodes.push(mainNode);
        state.isDirty = true;
      });
    },

    removeModule: (moduleId) => {
      set((state) => {
        state.modules = state.modules.filter((m) => m.id !== moduleId);
        // Remove all nodes associated with this module
        const removedNodeIds = new Set(
          state.nodes.filter((n) => n.module === moduleId).map((n) => n.id)
        );
        state.nodes = state.nodes.filter((n) => n.module !== moduleId);
        state.edges = state.edges.filter(
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
        const now = Date.now();
        const data = node.data as NodeData & { createdAt?: number; updatedAt?: number };
        if (!data.createdAt) data.createdAt = now;
        data.updatedAt = data.updatedAt || now;
        state.nodes.push(node);
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
        state.nodes = state.nodes.filter((n) => n.id !== nodeId);
        state.edges = state.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        );
        if (state.selectedNodeId === nodeId) {
          state.selectedNodeId = null;
        }
        state.isDirty = true;
      });
    },

    deleteNodeAndSave: async (nodeId) => {
      if (savePromise) {
        await savePromise;
      }
      if (get().isDirty) {
        await get().saveCanvas();
      }

      const snapshot = get();
      if (!snapshot.currentCanvasId) return;
      if (!snapshot.nodes.some((n) => n.id === nodeId)) return;

      const nextNodes = snapshot.nodes.filter((n) => n.id !== nodeId);
      const nextEdges = snapshot.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

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
        state.edges = state.edges.filter((e) => e.id !== edgeId);
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
        state.viewport = viewport;
      });
    },
  }))
);
