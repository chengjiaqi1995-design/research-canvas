export const OPEN_CANVAS_TARGET_EVENT = 'research-canvas:open-canvas-target';

export interface CanvasDeepLinkTarget {
  workspaceId?: string;
  workspaceName?: string;
  canvasId: string;
  canvasTitle?: string;
  nodeId?: string;
  nodeTitle?: string;
}

export function openCanvasTarget(target: CanvasDeepLinkTarget) {
  window.dispatchEvent(new CustomEvent<CanvasDeepLinkTarget>(OPEN_CANVAS_TARGET_EVENT, { detail: target }));
}
