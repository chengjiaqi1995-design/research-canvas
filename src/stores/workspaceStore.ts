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
      set((state) => {
        state.workspaces = workspaces;
      });
    },

    createWorkspace: async (name, icon) => {
      const now = Date.now();
      const workspace: Workspace = {
        id: generateId(),
        name,
        icon,
        canvasIds: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
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
      set((state) => {
        const [moved] = state.workspaces.splice(fromIndex, 1);
        state.workspaces.splice(toIndex, 0, moved);
      });
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

    setCurrentCanvas: (id) => {
      set((state) => {
        state.currentCanvasId = id;
      });
    },
  }))
);
