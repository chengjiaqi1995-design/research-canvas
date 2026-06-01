import { generateId } from '../utils/id.ts';
import { createMainTextNode } from './canvasNodeFactory.ts';
import type { Canvas, CanvasEdge, CanvasNode, ModuleConfig, NodeType } from '../types/index.ts';

export type CanvasViewport = Canvas['viewport'];

export interface LoadedCanvasPayload {
  modules?: ModuleConfig[] | null;
  nodes?: CanvasNode[] | null;
  edges?: CanvasEdge[] | null;
  viewport?: Partial<CanvasViewport> | null;
  updatedAt?: number | null;
}

export interface NormalizedCanvasSnapshot {
  modules: ModuleConfig[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  updatedAt: number;
  needsSave: boolean;
}

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

/** Default modules for backward compatibility with old data. */
export const DEFAULT_MODULES: ModuleConfig[] = [
  { id: 'supply_demand', name: '供需', order: 0 },
  { id: 'cost_curve', name: '成本曲线', order: 1 },
  { id: 'money_flow', name: 'Money Flow', order: 2 },
  { id: 'timing', name: 'Timing', order: 3 },
];

function makeUniqueNodeId(seen: Set<string>): string {
  let id = generateId();
  while (seen.has(id)) id = generateId();
  seen.add(id);
  return id;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeViewport(viewport: LoadedCanvasPayload['viewport']): CanvasViewport {
  if (!viewport) return DEFAULT_CANVAS_VIEWPORT;

  return {
    x: isFiniteNumber(viewport.x) ? viewport.x : DEFAULT_CANVAS_VIEWPORT.x,
    y: isFiniteNumber(viewport.y) ? viewport.y : DEFAULT_CANVAS_VIEWPORT.y,
    zoom: isFiniteNumber(viewport.zoom) && viewport.zoom > 0
      ? viewport.zoom
      : DEFAULT_CANVAS_VIEWPORT.zoom,
  };
}

function isLoadableNode(value: unknown): value is CanvasNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as Partial<CanvasNode>;
  const data = node.data as { type?: unknown } | undefined;
  return Boolean(data && typeof data.type === 'string');
}

function normalizeNodeShape(node: CanvasNode): { node: CanvasNode; changed: boolean } {
  const dataType = (node.data as { type: string }).type as NodeType;
  const type = node.type || dataType;
  const position = node.position;
  const normalizedPosition = {
    x: isFiniteNumber(position?.x) ? position.x : 0,
    y: isFiniteNumber(position?.y) ? position.y : 0,
  };

  return {
    node: {
      ...node,
      type,
      position: normalizedPosition,
    },
    changed:
      type !== node.type
      || !position
      || normalizedPosition.x !== position.x
      || normalizedPosition.y !== position.y,
  };
}

function normalizeLoadedNodes(nodes: CanvasNode[]): {
  nodes: CanvasNode[];
  seenIds: Set<string>;
  changed: boolean;
} {
  const seenIds = new Set<string>();
  let changed = false;

  const normalized = nodes.map((node) => {
    const rawId = typeof node.id === 'string' ? node.id.trim() : '';
    if (!rawId || seenIds.has(rawId)) {
      changed = true;
      return { ...node, id: makeUniqueNodeId(seenIds) };
    }

    seenIds.add(rawId);
    if (rawId !== node.id) {
      changed = true;
      return { ...node, id: rawId };
    }

    return node;
  });

  return { nodes: normalized, seenIds, changed };
}

function normalizeModules(modules: LoadedCanvasPayload['modules'], nodes: CanvasNode[]): {
  modules: ModuleConfig[];
  changed: boolean;
} {
  if (Array.isArray(modules) && modules.length > 0) {
    let changed = false;
    const normalized = modules
      .filter((module): module is ModuleConfig => (
        Boolean(module)
        && typeof module.id === 'string'
        && module.id.trim().length > 0
        && typeof module.name === 'string'
      ))
      .map((module, index) => {
        const id = module.id.trim();
        const order = isFiniteNumber(module.order) ? module.order : index;
        if (id !== module.id || order !== module.order) changed = true;
        return { ...module, id, order };
      });

    return normalized.length > 0
      ? { modules: normalized, changed }
      : { modules: [{ id: 'default', name: '默认', order: 0 }], changed: true };
  }

  const usedModuleIds = new Set(
    nodes.map((node) => node.module).filter((module): module is string => Boolean(module)),
  );

  if (usedModuleIds.size === 0) {
    return { modules: [{ id: 'default', name: '默认', order: 0 }], changed: true };
  }

  const defaultModules = DEFAULT_MODULES.filter((module) => usedModuleIds.has(module.id));
  const knownModuleIds = new Set(defaultModules.map((module) => module.id));
  const customModules = [...usedModuleIds]
    .filter((id) => !knownModuleIds.has(id))
    .map((id, index) => ({
      id,
      name: id,
      order: defaultModules.length + index,
    }));

  return {
    modules: [...defaultModules, ...customModules],
    changed: true,
  };
}

function ensureModuleMainNodes(
  modules: ModuleConfig[],
  nodes: CanvasNode[],
  seenIds: Set<string>,
): { nodes: CanvasNode[]; changed: boolean } {
  let nextNodes = nodes;
  let changed = false;

  for (const module of modules) {
    const hasMain = nextNodes.some(
      (node) => node.module === module.id && node.isMain && node.data.type === 'text',
    );

    if (!hasMain) {
      if (nextNodes === nodes) nextNodes = [...nodes];
      nextNodes.push(createMainTextNode(module, { id: makeUniqueNodeId(seenIds) }));
      changed = true;
    }
  }

  return { nodes: nextNodes, changed };
}

function resetStreamingAICards(nodes: CanvasNode[]): { nodes: CanvasNode[]; changed: boolean } {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.data.type !== 'ai_card' || !node.data.isStreaming) return node;
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        isStreaming: false,
      },
    };
  });

  return { nodes: nextNodes, changed };
}

export function normalizeLoadedCanvas(
  canvas: LoadedCanvasPayload,
  now = Date.now(),
): NormalizedCanvasSnapshot {
  const loadedNodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const loadableNodes = loadedNodes.filter(isLoadableNode);
  const shapedNodes = loadableNodes.map(normalizeNodeShape);
  const droppedNodeCount = loadedNodes.length - loadableNodes.length;
  const shapeChanged = shapedNodes.some((result) => result.changed);
  const rawNodes = shapedNodes.map((result) => result.node);
  const normalizedNodes = normalizeLoadedNodes(rawNodes);
  const normalizedModules = normalizeModules(canvas.modules, normalizedNodes.nodes);
  const nodesWithMainNodes = ensureModuleMainNodes(
    normalizedModules.modules,
    normalizedNodes.nodes,
    normalizedNodes.seenIds,
  );
  const nodesWithResetStreaming = resetStreamingAICards(nodesWithMainNodes.nodes);

  return {
    modules: normalizedModules.modules,
    nodes: nodesWithResetStreaming.nodes,
    edges: Array.isArray(canvas.edges) ? canvas.edges : [],
    viewport: normalizeViewport(canvas.viewport),
    updatedAt: isFiniteNumber(canvas.updatedAt) ? canvas.updatedAt : now,
    needsSave:
      droppedNodeCount > 0
      || shapeChanged
      || normalizedNodes.changed
      || normalizedModules.changed
      || nodesWithMainNodes.changed
      || nodesWithResetStreaming.changed,
  };
}
