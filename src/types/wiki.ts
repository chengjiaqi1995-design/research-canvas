export interface WikiArticle {
  id: string;
  industryCategory: string; // The subcategory string (e.g. "算电协同")
  title: string;
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
