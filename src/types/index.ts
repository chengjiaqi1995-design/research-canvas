// === Core Types ===

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  description?: string;
  canvasIds: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  order: number;
}

export interface ModuleConfig {
  id: string;
  name: string;
  collapsed?: boolean;
  order: number;
}

export interface Canvas {
  id: string;
  workspaceId: string;
  title: string;
  template: CanvasTemplate;
  modules: ModuleConfig[];
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  createdAt: number;
  updatedAt: number;
}

export type CanvasTemplate = 'supply_demand' | 'cost_curve' | 'custom';

// === Node Types ===

export interface CanvasNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  data: NodeData;
  module?: string;
  isMain?: boolean;
  style?: NodeStyle;
  locked?: boolean;
  zIndex?: number;
}

export type NodeType = 'text' | 'table' | 'chart' | 'image' | 'formula' | 'pdf';

export type NodeData =
  | TextNodeData
  | TableNodeData
  | ChartNodeData
  | ImageNodeData
  | FormulaNodeData
  | PdfNodeData;

export interface TextNodeData {
  type: 'text';
  title: string;
  content: string;
}

export interface PdfNodeData {
  type: 'pdf';
  title: string;
  url: string;
  filename?: string;
}

export interface SheetData {
  sheetName: string;
  columns: TableColumn[];
  rows: TableRow[];
}

export interface TableNodeData {
  type: 'table';
  title: string;
  sheetName: string;
  columns: TableColumn[];
  rows: TableRow[];
  summaryRow?: boolean;
  sheets?: SheetData[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbookData?: any;  // Univer IWorkbookData snapshot — full Excel format preservation
}

export interface TableColumn {
  id: string;
  name: string;
  width: number;
  colType: 'text' | 'number' | 'formula' | 'date' | 'percent';
  format?: string;
}

export interface TableRow {
  id: string;
  label?: string;
  cells: Record<string, CellValue>;
}

export interface CellStyle {
  bg?: string;       // background color, e.g. "#FF0000"
  fc?: string;       // font color
  bl?: boolean;      // bold
  it?: boolean;      // italic
}

export type CellValue =
  | string
  | number
  | null
  | { formula: string }
  | { value: string | number | null; style: CellStyle };

export interface ChartNodeData {
  type: 'chart';
  title: string;
  chartType: 'line' | 'bar' | 'area' | 'scatter' | 'pie' | 'stacked_bar';
  sourceNodeId: string;
  xAxisColumn: string;
  seriesColumns: string[];
  options?: {
    showLegend?: boolean;
    showGrid?: boolean;
    colors?: string[];
    yAxisLabel?: string;
    xAxisLabel?: string;
  };
}

export interface ImageNodeData {
  type: 'image';
  title?: string;
  src: string;
  alt?: string;
}

export interface FormulaNodeData {
  type: 'formula';
  title: string;
  formula: string;
  format?: string;
  unit?: string;
  fontSize?: number;
}

// === Edges ===

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  animated?: boolean;
  style?: { stroke?: string };
}

// === Styles ===

export interface NodeStyle {
  backgroundColor?: string;
  borderColor?: string;
  headerColor?: string;
  opacity?: number;
}
