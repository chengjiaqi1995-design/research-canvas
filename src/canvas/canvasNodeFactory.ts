import { generateId } from '../utils/id.ts';
import type {
  CanvasNode,
  HtmlNodeData,
  MarkdownNodeData,
  ModuleConfig,
  NodeData,
  NodeStyle,
  NodeType,
  PdfNodeData,
  TableNodeData,
  TextNodeData,
} from '../types/index.ts';

export interface CanvasPosition {
  x: number;
  y: number;
}

interface BaseNodeOptions {
  id?: string;
  module?: string;
  isMain?: boolean;
  style?: NodeStyle;
}

interface TextNodeOptions extends BaseNodeOptions {
  title?: string;
  content?: string;
}

interface TitledContentNodeOptions extends BaseNodeOptions {
  title: string;
  content: string;
}

interface PdfNodeOptions extends BaseNodeOptions {
  title: string;
  url: string;
  filename?: string;
}

type TimestampedNodeData = NodeData & {
  createdAt?: number;
  updatedAt?: number;
};

function createCanvasNode<TData extends NodeData>(
  type: NodeType,
  position: CanvasPosition,
  data: TData,
  options: BaseNodeOptions = {},
): CanvasNode {
  const node: CanvasNode = {
    id: options.id ?? generateId(),
    type,
    position,
    data,
  };

  if (options.module !== undefined) node.module = options.module;
  if (options.isMain !== undefined) node.isMain = options.isMain;
  if (options.style !== undefined) node.style = options.style;

  return node;
}

export function createTextNode(
  position: CanvasPosition,
  options: TextNodeOptions = {},
): CanvasNode {
  const data: TextNodeData = {
    type: 'text',
    title: options.title ?? '新笔记',
    content: options.content ?? '<p>在此输入内容...</p>',
  };

  return createCanvasNode('text', position, data, options);
}

export function createMainTextNode(
  module: Pick<ModuleConfig, 'id' | 'name'>,
  options: Pick<BaseNodeOptions, 'id'> = {},
): CanvasNode {
  return createTextNode(
    { x: 0, y: 0 },
    {
      id: options.id,
      module: module.id,
      isMain: true,
      title: module.name,
      content: '',
    },
  );
}

export function createTableNode(
  position: CanvasPosition,
  options: BaseNodeOptions = {},
): CanvasNode {
  const tableId = options.id ?? generateId();
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

  return createCanvasNode('table', position, data, { ...options, id: tableId });
}

export function createHtmlNode(
  position: CanvasPosition,
  options: TitledContentNodeOptions,
): CanvasNode {
  const data: HtmlNodeData = {
    type: 'html',
    title: options.title,
    content: options.content,
  };

  return createCanvasNode('html', position, data, options);
}

export function createMarkdownNode(
  position: CanvasPosition,
  options: TitledContentNodeOptions,
): CanvasNode {
  const data: MarkdownNodeData = {
    type: 'markdown',
    title: options.title,
    content: options.content,
  };

  return createCanvasNode('markdown', position, data, options);
}

export function createPdfNode(position: CanvasPosition, options: PdfNodeOptions): CanvasNode {
  const data: PdfNodeData = {
    type: 'pdf',
    title: options.title,
    url: options.url,
    filename: options.filename,
  };

  return createCanvasNode('pdf', position, data, options);
}

export function withNodeTimestamps(node: CanvasNode, now = Date.now()): CanvasNode {
  const data = node.data as TimestampedNodeData;
  const createdAt = data.createdAt ?? now;
  const updatedAt = data.updatedAt ?? now;

  if (data.createdAt === createdAt && data.updatedAt === updatedAt) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      createdAt,
      updatedAt,
    } as unknown as NodeData,
  };
}
