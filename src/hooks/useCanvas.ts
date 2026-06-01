import { useCallback } from 'react';
import { useCanvasStore } from '../stores/canvasStore.ts';
import {
  createHtmlNode,
  createMarkdownNode,
  createTableNode,
  createTextNode,
} from '../canvas/canvasNodeFactory.ts';

export function useCanvas() {
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);

  const addTextNode = useCallback(
    (position: { x: number; y: number }, module?: string, initialData?: { title?: string, content?: string }) => {
      const node = createTextNode(position, {
        module,
        title: initialData?.title,
        content: initialData?.content,
      });
      addNode(node);
      return node;
    },
    [addNode]
  );

  const addTableNode = useCallback(
    (position: { x: number; y: number }, module?: string) => {
      const node = createTableNode(position, { module });
      addNode(node);
      return node;
    },
    [addNode]
  );

  const addHtmlNode = useCallback(
    (position: { x: number; y: number }, title: string, content: string, module?: string) => {
      const node = createHtmlNode(position, {
        module,
        title,
        content,
      });
      addNode(node);
      return node;
    },
    [addNode]
  );

  const addMarkdownNode = useCallback(
    (position: { x: number; y: number }, title: string, content: string, module?: string) => {
      const node = createMarkdownNode(position, {
        module,
        title,
        content,
      });
      addNode(node);
      return node;
    },
    [addNode]
  );

  return {
    addTextNode,
    addTableNode,
    addHtmlNode,
    addMarkdownNode,
    removeNode,
  };
}
