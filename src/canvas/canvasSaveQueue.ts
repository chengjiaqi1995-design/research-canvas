import { canvasApi } from '../db/apiClient.ts';
import type { CanvasEdge, CanvasNode, ModuleConfig } from '../types/index.ts';
import type { CanvasViewport } from './canvasLoadNormalizer.ts';

export interface CanvasSaveTask {
  canvasId: string;
  modules: ModuleConfig[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  updatedAt: number;
}

interface CanvasSaveQueueOptions {
  onSaved: (task: CanvasSaveTask, updatedAt: number) => void;
  onFailed: (task: CanvasSaveTask, error: unknown) => void;
  onDrained: () => void;
}

export function createCanvasSaveQueue(options: CanvasSaveQueueOptions) {
  let activePromise: Promise<void> | null = null;
  let queuedTask: CanvasSaveTask | null = null;

  const drain = async (initialTask: CanvasSaveTask) => {
    let currentTask: CanvasSaveTask | null = initialTask;

    while (currentTask) {
      try {
        const updatedAt = currentTask.updatedAt || Date.now();
        await canvasApi.update(currentTask.canvasId, {
          modules: currentTask.modules,
          nodes: currentTask.nodes,
          edges: currentTask.edges,
          viewport: currentTask.viewport,
          updatedAt,
        });
        options.onSaved(currentTask, updatedAt);
      } catch (error) {
        queuedTask = null;
        options.onFailed(currentTask, error);
        break;
      }

      currentTask = queuedTask;
      queuedTask = null;
    }

    activePromise = null;
    options.onDrained();
  };

  return {
    enqueue(task: CanvasSaveTask): Promise<void> {
      if (activePromise) {
        queuedTask = task;
        return activePromise;
      }

      activePromise = drain(task);
      return activePromise;
    },

    whenIdle(): Promise<void> {
      return activePromise ?? Promise.resolve();
    },
  };
}
