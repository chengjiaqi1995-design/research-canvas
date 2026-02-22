import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { workspaceApi, canvasApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { Workspace, Canvas } from '../types/index.ts';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, icon: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  reorderWorkspaces: (fromIndex: number, toIndex: number) => void;
  setCurrentWorkspace: (id: string | null) => void;

  // Canvas management within workspace
  canvases: Canvas[];
  currentCanvasId: string | null;
  loadCanvases: (workspaceId: string) => Promise<void>;
  createCanvas: (workspaceId: string, title: string, template?: Canvas['template']) => Promise<Canvas>;
  deleteCanvas: (id: string) => Promise<void>;
  renameCanvas: (id: string, title: string) => Promise<void>;
  moveCanvas: (canvasId: string, targetWorkspaceId: string) => Promise<void>;
  setCurrentCanvas: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspaces: [],
    currentWorkspaceId: null,
    canvases: [],
    currentCanvasId: null,

    loadWorkspaces: async () => {
      const workspaces = await workspaceApi.list();
      workspaces.sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
      set((state) => {
        state.workspaces = workspaces;
      });
    },

    createWorkspace: async (name, icon) => {
      const now = Date.now();
      const existing = get().workspaces;
      const maxOrder = existing.reduce((max, w) => Math.max(max, w.order || 0), -1);

      const workspace: Workspace = {
        id: generateId(),
        name,
        icon,
        canvasIds: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
        order: maxOrder + 1,
      };
      await workspaceApi.create(workspace);
      set((state) => {
        state.workspaces.unshift(workspace);
      });
      return workspace;
    },

    deleteWorkspace: async (id) => {
      await workspaceApi.delete(id);
      set((state) => {
        state.workspaces = state.workspaces.filter((w) => w.id !== id);
        if (state.currentWorkspaceId === id) {
          state.currentWorkspaceId = state.workspaces[0]?.id ?? null;
          state.canvases = [];
          state.currentCanvasId = null;
        }
      });
    },

    renameWorkspace: async (id, name) => {
      const now = Date.now();
      await workspaceApi.update(id, { name, updatedAt: now });
      set((state) => {
        const ws = state.workspaces.find((w) => w.id === id);
        if (ws) {
          ws.name = name;
          ws.updatedAt = now;
        }
      });
    },

    reorderWorkspaces: (fromIndex, toIndex) => {
      const workspaces = [...get().workspaces];
      const [moved] = workspaces.splice(fromIndex, 1);
      workspaces.splice(toIndex, 0, moved);

      // Update orders
      const updates: Promise<any>[] = [];
      workspaces.forEach((w, index) => {
        if (w.order !== index) {
          w.order = index;
          updates.push(workspaceApi.update(w.id, { order: index }));
        }
      });

      set((state) => {
        state.workspaces = workspaces;
      });

      // Fire and forget updates (optimistic UI)
      Promise.all(updates).catch(console.error);
    },

    setCurrentWorkspace: (id) => {
      set((state) => {
        state.currentWorkspaceId = id;
        state.currentCanvasId = null;
        state.canvases = [];
      });
      if (id) {
        get().loadCanvases(id);
      }
    },

    loadCanvases: async (workspaceId) => {
      const canvases = await canvasApi.list(workspaceId);
      set((state) => {
        state.canvases = canvases;
      });
    },

    createCanvas: async (workspaceId, title, template = 'custom') => {
      const now = Date.now();
      const canvas: Canvas = {
        id: generateId(),
        workspaceId,
        title,
        template,
        modules: [],
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: now,
        updatedAt: now,
      };
      await canvasApi.create(canvas);

      // Update workspace canvasIds
      const workspace = get().workspaces.find((w) => w.id === workspaceId);
      if (workspace) {
        const updatedCanvasIds = [...workspace.canvasIds, canvas.id];
        await workspaceApi.update(workspaceId, {
          canvasIds: updatedCanvasIds,
          updatedAt: now,
        });
      }

      set((state) => {
        state.canvases.unshift(canvas);
        const ws = state.workspaces.find((w) => w.id === workspaceId);
        if (ws) {
          ws.canvasIds.push(canvas.id);
          ws.updatedAt = now;
        }
      });
      return canvas;
    },

    deleteCanvas: async (id) => {
      const canvas = get().canvases.find((c) => c.id === id);
      if (canvas) {
        const workspace = get().workspaces.find((w) => w.id === canvas.workspaceId);
        if (workspace) {
          const updatedCanvasIds = workspace.canvasIds.filter((cid) => cid !== id);
          await workspaceApi.update(workspace.id, {
            canvasIds: updatedCanvasIds,
            updatedAt: Date.now(),
          });
        }
      }
      await canvasApi.delete(id);
      set((state) => {
        state.canvases = state.canvases.filter((c) => c.id !== id);
        if (state.currentCanvasId === id) {
          state.currentCanvasId = state.canvases[0]?.id ?? null;
        }
      });
    },

    renameCanvas: async (id, title) => {
      const now = Date.now();
      await canvasApi.update(id, { title, updatedAt: now });
      set((state) => {
        const canvas = state.canvases.find((c) => c.id === id);
        if (canvas) {
          canvas.title = title;
          canvas.updatedAt = now;
        }
      });
    },

    moveCanvas: async (canvasId, targetWorkspaceId) => {
      // 1. Find the canvas and its existing workspace
      let canvas = get().canvases.find((c) => c.id === canvasId);
      let sourceWorkspaceId: string | undefined;

      if (canvas) {
        sourceWorkspaceId = canvas.workspaceId;
      } else {
        // If the canvas isn't currently loaded, we need to fetch it (or handle it)
        // For our current UI drag & drop, the canvas MUST be loaded to be dragged,
        // but just in case, we can deduce it from the workspaces array.
        const sourceWs = get().workspaces.find(w => w.canvasIds.includes(canvasId));
        if (!sourceWs) return; // Cannot find the canvas at all
        sourceWorkspaceId = sourceWs.id;
      }

      if (sourceWorkspaceId === targetWorkspaceId) return; // Already there

      const now = Date.now();

      // 2. Perform DB updates in parallel
      const sourceWs = get().workspaces.find(w => w.id === sourceWorkspaceId);
      const targetWs = get().workspaces.find(w => w.id === targetWorkspaceId);

      const updates = [];
      updates.push(canvasApi.update(canvasId, { workspaceId: targetWorkspaceId, updatedAt: now }));

      if (sourceWs) {
        const newSourceIds = sourceWs.canvasIds.filter(id => id !== canvasId);
        updates.push(workspaceApi.update(sourceWorkspaceId, { canvasIds: newSourceIds, updatedAt: now }));
      }

      if (targetWs) {
        const newTargetIds = [...targetWs.canvasIds, canvasId];
        updates.push(workspaceApi.update(targetWorkspaceId, { canvasIds: newTargetIds, updatedAt: now }));
      }

      // Optimistically apply updates before waiting for API
      set((state) => {
        const sw = state.workspaces.find(w => w.id === sourceWorkspaceId);
        if (sw) sw.canvasIds = sw.canvasIds.filter(id => id !== canvasId);

        const tw = state.workspaces.find(w => w.id === targetWorkspaceId);
        if (tw) tw.canvasIds.push(canvasId);

        // If we are showing the source workspace canvases, remove it from the view
        if (state.currentWorkspaceId !== targetWorkspaceId) {
          state.canvases = state.canvases.filter(c => c.id !== canvasId);
          if (state.currentCanvasId === canvasId) {
            state.currentCanvasId = state.canvases[0]?.id || null;
          }
        } else {
          // Edge case: moving it to the ACTIVE workspace (would only happen if UI allowed dragging from elsewhere)
          if (canvas) {
            canvas.workspaceId = targetWorkspaceId;
            state.canvases.push(canvas);
          }
        }
      });

      try {
        await Promise.all(updates);
      } catch (e) {
        console.error("Failed to move canvas", e);
        // We could revert optimistic update here, but for simplicity we rely on next load
      }
    },

    setCurrentCanvas: (id) => {
      set((state) => {
        state.currentCanvasId = id;
      });
    },
  }))
);
