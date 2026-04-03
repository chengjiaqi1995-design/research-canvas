// === Core Types ===

export type WorkspaceCategory = 'overall' | 'industry' | 'personal';

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  description?: string;
  category?: WorkspaceCategory;
  /** 行业大类标签，如 '能源'、'工业'。用于右键菜单手动归类 */
  industryCategory?: string;
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

export type NodeType = 'text' | 'table' | 'chart' | 'image' | 'formula' | 'pdf' | 'html' | 'markdown' | 'ai_card';

export type NodeData =
  | TextNodeData
  | TableNodeData
  | ChartNodeData
  | ImageNodeData
  | FormulaNodeData
  | PdfNodeData
  | HtmlNodeData
  | MarkdownNodeData
  | AICardNodeData;

export interface HtmlNodeData {
  type: 'html';
  title: string;
  content: string;
}

export interface MarkdownNodeData {
  type: 'markdown';
  title: string;
  content: string;
  metadata?: Record<string, string>;
  tags?: string[];
}

export interface TextNodeData {
  type: 'text';
  title: string;
  content: string;
  metadata?: Record<string, string>;
  tags?: string[];
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

// === AI Research Types ===

export type AIProvider = 'anthropic' | 'openai' | 'google' | 'dashscope' | 'deepseek' | 'minimax' | 'xiaomi';

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
}

export interface AISettings {
  keys: Partial<Record<AIProvider, string>>;
  defaultModel: string;
  excelParsingModel?: string;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIPanel {
  id: string;
  title: string;
  model: string;
  prompt: string;
  response: string;
  editedResponse: string;
  isStreaming: boolean;
  systemPrompt?: string;
  selected: boolean;  // for merge-to-canvas checkbox
}

// === AI Card Types ===

export type AICardSourceMode = 'notes' | 'web' | 'notes_web';

export interface AISkill {
  id: string;
  name: string;
  description?: string;
  content: string;
  createdAt: number;
}

export interface AICardConfig {
  model: string;
  sourceMode: AICardSourceMode;
  sourceNodeIds: string[];
  outputFormat: 'markdown' | 'text';
  webSearchKeywords?: string;
  // Folder-based source filtering
  sourceWorkspaceIds?: string[];
  sourceCanvasIds?: string[];
  sourceDateFrom?: string;
  sourceDateTo?: string;
  sourceDateField?: 'occurred' | 'created'; // 按发生日期还是创建时间筛选
  skillId?: string; // Mounted Methodology Library ID
}

export interface AICardNodeData {
  type: 'ai_card';
  title: string;
  prompt: string;
  config: AICardConfig;
  generatedContent: string;
  editedContent: string;
  isStreaming: boolean;
  lastGeneratedAt?: number;
  error?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  category: 'analysis' | 'summary' | 'comparison' | 'research' | 'custom';
}

// === Tracker Types ===

export interface TrackerColumn {
  id: string;
  name: string;
  type: 'number' | 'text' | 'date';
  period?: 'week' | 'month' | 'quarter' | 'year';
}

export interface TrackerEntity {
  id: string;
  name: string;
}

export interface TrackerRecord {
  entityId: string;
  timePeriod: string; // e.g. "2026-Q1" or "2026-03"
  values: Record<string, string | number>;
  events?: string[]; // News/events in this period for this entity
}

export interface Tracker {
  id: string;
  workspaceId: string; // bound to an industry workspace
  name: string;
  moduleType?: 'data' | 'company' | 'expert'; // newly added module classifier
  columns: TrackerColumn[];
  entities: TrackerEntity[];
  records: TrackerRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface TrackerInboxItem {
  id: string;
  source: 'ai_snippet' | 'crawler' | 'canvas';
  content: string;
  targetCompany: string; // mapped to TrackerEntity.name
  targetMetric: string; // mapped to TrackerColumn.name
  extractedValue: number | string;
  timePeriod: string;
  timestamp: number;
}
