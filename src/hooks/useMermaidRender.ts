import { useEffect } from 'react';
import type { RefObject } from 'react';
import { renderMermaidInElement } from '../utils/mermaidRenderer.ts';

export function useMermaidRender(
  ref: RefObject<HTMLElement | null>,
  dependencies: ReadonlyArray<unknown> = [],
) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    let disposed = false;
    let timer: number | undefined;

    const scheduleRender = () => {
      if (disposed) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!disposed) void renderMermaidInElement(root);
      }, 80);
    };

    scheduleRender();
    const observer = new MutationObserver(scheduleRender);
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      observer.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...dependencies]);
}
