import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { generateId } from '../utils/id.ts';
import type { WikiArticle, WikiAction } from '../types/wiki.ts';
import { industryWikiApi } from '../db/apiClient.ts';

interface IndustryWikiState {
  articles: WikiArticle[];
  actions: WikiAction[];
  wikiPageTypes: string; // cloud-synced page type definitions

  // Basic CRUD
  loadWikiData: () => Promise<void>;
  addArticle: (industryCategory: string, title: string, content: string, tags?: string[], description?: string) => string;
  updateArticle: (articleId: string, content: string, title?: string, description?: string) => void;
  deleteArticle: (articleId: string) => void;
  setWikiPageTypes: (pageTypes: string) => void;

  // AI Log tracing
  logAction: (industryCategory: string, action: 'create' | 'update' | 'delete', articleTitle: string, description: string) => void;

  privateSave: () => void;
}

// Temporary local-storage persistance for the Wiki while testing
const STORAGE_KEY = 'rc_industry_wiki';

export const useIndustryWikiStore = create<IndustryWikiState>()(
  immer((set, get) => ({
    articles: [],
    actions: [],
    wikiPageTypes: '',

    loadWikiData: async () => {
      try {
        let loadedFromCloud = false;
        try {
          const item = await industryWikiApi.get();
          if (item && (item.articles?.length > 0 || item.actions?.length > 0)) {
            set((state) => {
              state.articles = item.articles || [];
              state.actions = item.actions || [];
              state.wikiPageTypes = item.wikiPageTypes || '';
            });
            loadedFromCloud = true;
          }
        } catch (apiErr) {
          console.warn('Failed to fetch wiki from cloud, attempting local fallback', apiErr);
        }

        if (!loadedFromCloud) {
          // Migration/Fallback from old localStorage
          const localItem = localStorage.getItem(STORAGE_KEY);
          if (localItem) {
            const parsed = JSON.parse(localItem);
            set((state) => {
              state.articles = parsed.articles || [];
              state.actions = parsed.actions || [];
              state.wikiPageTypes = parsed.wikiPageTypes || '';
            });
            // Try to sync it up immediately
            get().privateSave();
          }
        }
      } catch (e) {
        console.error('Failed to load wiki data completely', e);
      }
    },

    privateSave: () => {
      const state = get();
      // Fire and forget save to cloud
      industryWikiApi.save({
        articles: state.articles,
        actions: state.actions,
        wikiPageTypes: state.wikiPageTypes,
      }).catch(e => console.error('Failed to save wiki to cloud', e));
    },

    setWikiPageTypes: (pageTypes: string) => {
      set(state => { state.wikiPageTypes = pageTypes; });
      (get() as any).privateSave();
    },

    addArticle: (industryCategory, title, content, tags = [], description = '') => {
      const id = generateId();
      set(state => {
        state.articles.push({
          id,
          industryCategory,
          title,
          description,
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

    updateArticle: (articleId, content, title, description) => {
      set(state => {
        const article = state.articles.find(a => a.id === articleId);
        if (article) {
          article.content = content;
          if (title) article.title = title;
          if (description) article.description = description;
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
