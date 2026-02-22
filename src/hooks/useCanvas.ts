import { useCallback } from 'react';
import { useCanvasStore } from '../stores/canvasStore.ts';
import { generateId } from '../utils/id.ts';
import type { NodeType, TextNodeData, TableNodeData, CanvasNode } from '../types/index.ts';

export function useCanvas() {
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);

  const addTextNode = useCallback(
    (position: { x: number; y: number }, module?: string, initialData?: { title?: string, content?: string }) => {
      const data: TextNodeData = {
        type: 'text',
        title: initialData?.title || '新笔记',
        content: initialData?.content || '<p>在此输入内容...</p>',
      };
      const node: CanvasNode = {
        id: generateId(),
        type: 'text' as NodeType,
        position,
        data,
        module,
      };
      addNode(node);
      return node;
    },
    [addNode]
  );

  const addTableNode = useCallback(
    (position: { x: number; y: number }, module?: string) => {
      const tableId = generateId();
      const data: TableNodeData = {
        type: 'table',
        title: '新表格',
        sheetName: `Sheet_${tableId.slice(0, 6)}`,
        columns: [
          { id: 'col_a', name: '列A', width: 100, colType: 'text' },
          { id: 'col_b', name: '列B', width: 100, colType: 'number' },
          { id: 'col_c', name: '列C', width: 100, colType: 'number' },
        ],
        rows: [
          { id: generateId(), cells: { col_a: '', col_b: null, col_c: null } },
          { id: generateId(), cells: { col_a: '', col_b: null, col_c: null } },
          { id: generateId(), cells: { col_a: '', col_b: null, col_c: null } },
        ],
      };
      const node: CanvasNode = {
        id: tableId,
        type: 'table' as NodeType,
        position,
        data,
        module,
      };
      addNode(node);
      return node;
    },
    [addNode]
  );

  const addHtmlNode = useCallback(
    (position: { x: number; y: number }, title: string, content: string, module?: string) => {
      const data: import('../types/index.ts').HtmlNodeData = {
        type: 'html',
        title,
        content,
      };
      const node: CanvasNode = {
        id: generateId(),
        type: 'html' as NodeType,
        position,
        data,
        module,
      };
      addNode(node);
      return node;
    },
    [addNode]
  );

  return {
    addTextNode,
    addTableNode,
    addHtmlNode,
    removeNode,
  };
}
