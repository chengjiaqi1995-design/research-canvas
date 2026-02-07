import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { db } from '../db/index.ts';
import { generateId } from '../utils/id.ts';
import type { Workspace, Canvas } from '../types/index.ts';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, icon: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  setCurrentWorkspace: (id: string | null) => void;

  // Canvas management within workspace
  canvases: Canvas[];
  currentCanvasId: string | null;
  loadCanvases: (workspaceId: string) => Promise<void>;
  createCanvas: (workspaceId: string, title: string, template?: Canvas['template']) => Promise<Canvas>;
  deleteCanvas: (id: string) => Promise<void>;
  setCurrentCanvas: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspaces: [],
    currentWorkspaceId: null,
    canvases: [],
    currentCanvasId: null,

    loadWorkspaces: async () => {
      const workspaces = await db.workspaces.orderBy('updatedAt').reverse().toArray();
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
      await db.workspaces.add(workspace);
      set((state) => {
        state.workspaces.unshift(workspace);
      });
      return workspace;
    },

    deleteWorkspace: async (id) => {
      await db.canvases.where('workspaceId').equals(id).delete();
      await db.workspaces.delete(id);
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
      await db.workspaces.update(id, { name, updatedAt: now });
      set((state) => {
        const ws = state.workspaces.find((w) => w.id === id);
        if (ws) {
          ws.name = name;
          ws.updatedAt = now;
        }
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
      const canvases = await db.canvases
        .where('workspaceId')
        .equals(workspaceId)
        .sortBy('updatedAt');
      canvases.reverse();
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
      await db.canvases.add(canvas);

      // Update workspace canvasIds
      const workspace = await db.workspaces.get(workspaceId);
      if (workspace) {
        workspace.canvasIds.push(canvas.id);
        workspace.updatedAt = now;
        await db.workspaces.put(workspace);
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
      const canvas = await db.canvases.get(id);
      if (canvas) {
        const workspace = await db.workspaces.get(canvas.workspaceId);
        if (workspace) {
          workspace.canvasIds = workspace.canvasIds.filter((cid) => cid !== id);
          workspace.updatedAt = Date.now();
          await db.workspaces.put(workspace);
        }
      }
      await db.canvases.delete(id);
      set((state) => {
        state.canvases = state.canvases.filter((c) => c.id !== id);
        if (state.currentCanvasId === id) {
          state.currentCanvasId = state.canvases[0]?.id ?? null;
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
