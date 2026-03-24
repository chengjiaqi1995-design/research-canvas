export interface SourceItem {
  id: string;
  title: string;
  content: string;
}

export type AggregationMode = 'comprehensive' | 'concise' | 'structured' | 'deep';

export const AppStatus = {
  IDLE: 'IDLE',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
} as const;

export type AppStatus = typeof AppStatus[keyof typeof AppStatus];

export interface AggregationResult {
  text: string;
  isTruncated: boolean;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  title?: string;
  sources: SourceItem[];
  result: string;
  isTruncated?: boolean;
}

export type ProgressCallback = (step: string, progress: number) => void;

