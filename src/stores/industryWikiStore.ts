import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { generateId } from '../utils/id.ts';
import type { WikiArticle, WikiAction } from '../types/wiki.ts';

interface IndustryWikiState {
  articles: WikiArticle[];
  actions: WikiAction[];
  
  // Basic CRUD
  loadWikiData: () => Promise<void>;
  addArticle: (industryCategory: string, title: string, content: string, tags?: string[]) => string;
  updateArticle: (articleId: string, content: string, title?: string) => void;
  deleteArticle: (articleId: string) => void;
  
  // AI Log tracing
  logAction: (industryCategory: string, action: 'create' | 'update' | 'delete', articleTitle: string, description: string) => void;
}

// Temporary local-storage persistance for the Wiki while testing
const STORAGE_KEY = 'rc_industry_wiki';

export const useIndustryWikiStore = create<IndustryWikiState>()(
  immer((set, get) => ({
    articles: [],
    actions: [],
    
    loadWikiData: async () => {
      try {
        const item = localStorage.getItem(STORAGE_KEY);
        if (item) {
          const parsed = JSON.parse(item);
          set((state) => {
            state.articles = parsed.articles || [];
            state.actions = parsed.actions || [];
          });
        }
      } catch (e) {}
    },

    privateSave: () => {
      const state = get();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        articles: state.articles,
        actions: state.actions
      }));
    },

    addArticle: (industryCategory, title, content, tags = []) => {
      const id = generateId();
      set(state => {
        state.articles.push({
          id,
          industryCategory,
          title,
          content,
          tags,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      });
      get().logAction(industryCategory, 'create', title, 'Initial creation');
      (get() as any).privateSave();
      return id;
    },

    updateArticle: (articleId, content, title) => {
      set(state => {
        const article = state.articles.find(a => a.id === articleId);
        if (article) {
          article.content = content;
          if (title) article.title = title;
          article.updatedAt = Date.now();
        }
      });
      (get() as any).privateSave();
    },

    deleteArticle: (articleId) => {
      let category = '';
      let title = '';
      set(state => {
        const article = state.articles.find(a => a.id === articleId);
        if (article) {
          category = article.industryCategory;
          title = article.title;
          state.articles = state.articles.filter(a => a.id !== articleId);
        }
      });
      if (category) {
        get().logAction(category, 'delete', title, 'Deleted manually or via lint');
      }
      (get() as any).privateSave();
    },

    logAction: (industryCategory, action, articleTitle, description) => {
      set(state => {
        state.actions.unshift({
          id: generateId(),
          industryCategory,
          action,
          articleTitle,
          description,
          timestamp: Date.now()
        });
        // Keep only latest 100 actions per category globally to save space
        if (state.actions.length > 500) {
           state.actions = state.actions.slice(0, 500);
        }
      });
      (get() as any).privateSave();
    }
  }))
);
