export interface WikiArticle {
  id: string;
  industryCategory: string; // The subcategory string (e.g. "算电协同")
  title: string;
  description: string; // One-line summary for index (<50 chars), maintained by LLM
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface WikiAction {
  id: string;
  industryCategory: string;
  action: 'create' | 'update' | 'delete';
  articleTitle: string;
  description: string;
  timestamp: number;
}

export interface WikiGenerationLog {
  id: string;
  industryCategory: string;
  model: string;
  promptTemplate: string;
  pageTypes: string;
  sourceCount: number;
  sourceSummary: string;
  generatedArticles: { title: string; content: string; action: string; scope?: string }[];
  label: string;
  note: string;
  createdAt: number;
}
