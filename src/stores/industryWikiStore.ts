import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { generateId } from '../utils/id.ts';
import type { WikiArticle, WikiAction } from '../types/wiki.ts';
import {
  wikiSettingsApi,
  wikiIndexApi,
  wikiBundleApi,
  industryWikiApi, // legacy fallback only
} from '../db/apiClient.ts';

export interface IndustryWikiConfig {
  customInstructions: string; // per-industry analysis focus, key questions, frameworks
}

interface IndustryWikiState {
  articles: WikiArticle[];
  actions: WikiAction[];
  wikiPageTypes: string; // global default page type definitions
  wikiMultiScopeRules: string; // multi-scope routing rules (cloud-synced)
  wikiLintDimensions: string; // lint audit dimensions (cloud-synced)
  industryConfigs: Record<string, IndustryWikiConfig>; // per-industry custom configs

  // Basic CRUD
  loadWikiData: () => Promise<void>;
  addArticle: (industryCategory: string, title: string, content: string, tags?: string[], description?: string) => string;
  updateArticle: (articleId: string, content: string, title?: string, description?: string) => void;
  deleteArticle: (articleId: string) => void;
  clearCategoryArticles: (industryCategory: string) => void;
  setWikiPageTypes: (pageTypes: string) => void;
  setWikiMultiScopeRules: (rules: string) => void;
  setWikiLintDimensions: (dims: string) => void;
  setIndustryConfig: (industryCategory: string, config: Partial<IndustryWikiConfig>) => void;
  getIndustryConfig: (industryCategory: string) => IndustryWikiConfig;

  // AI Log tracing
  logAction: (industryCategory: string, action: 'create' | 'update' | 'delete', articleTitle: string, description: string) => void;

  // Persistence internals (exposed for debugging/migration; callers normally don't invoke directly)
  saveSettings: () => void;
  saveBundle: (topLevelIndustry: string) => void;
}

// Backup-only local cache (helps offline dev; cloud is the source of truth)
const LOCAL_BACKUP_KEY = 'rc_industry_wiki_cache';

// Split "铝::公司A" → "铝". Empty/undefined → "__uncategorized".
function topLevelOf(industryCategory: string | undefined | null): string {
  if (!industryCategory) return '__uncategorized';
  const top = industryCategory.split('::')[0].trim();
  return top || '__uncategorized';
}

export const useIndustryWikiStore = create<IndustryWikiState>()(
  immer((set, get) => ({
    articles: [],
    actions: [],
    wikiPageTypes: '',
    wikiMultiScopeRules: '',
    wikiLintDimensions: '',
    industryConfigs: {},

    loadWikiData: async () => {
      // 1. Load global settings (page types, multi-scope rules, lint, industryConfigs)
      // 2. Load index → list of industries
      // 3. Load each industry bundle and union into flat arrays
      // 4. If all three above come back empty, fall back to legacy blob + localStorage
      try {
        let loadedFromCloud = false;

        try {
          const [settings, index] = await Promise.all([
            wikiSettingsApi.get(),
            wikiIndexApi.list(),
          ]);

          if (settings) {
            set((state) => {
              state.wikiPageTypes = settings.wikiPageTypes || '';
              state.wikiMultiScopeRules = settings.wikiMultiScopeRules || '';
              state.wikiLintDimensions = settings.wikiLintDimensions || '';
              state.industryConfigs = settings.industryConfigs || {};
            });
          }

          if (Array.isArray(index) && index.length > 0) {
            const bundles = await Promise.all(
              index.map((e) => wikiBundleApi.get(e.industry).catch(() => null))
            );
            const allArticles: WikiArticle[] = [];
            const allActions: WikiAction[] = [];
            for (const b of bundles) {
              if (!b) continue;
              if (Array.isArray(b.articles)) allArticles.push(...b.articles);
              if (Array.isArray(b.actions)) allActions.push(...b.actions);
            }
            // Actions sorted by timestamp desc (newest first)
            allActions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            set((state) => {
              state.articles = allArticles;
              state.actions = allActions;
            });
            loadedFromCloud = true;
          } else if (settings) {
            // Settings exist but no bundles yet → empty wiki, still a valid cloud load
            set((state) => {
              state.articles = [];
              state.actions = [];
            });
            loadedFromCloud = true;
          }
        } catch (apiErr) {
          console.warn('Failed to fetch wiki from cloud via new API, trying legacy blob', apiErr);
        }

        // Legacy fallback: old /industry-wiki single blob (server lazy-migrates on GET too,
        // so this path is rarely hit — but keep it for older deployments)
        if (!loadedFromCloud) {
          try {
            const legacy = await industryWikiApi.get();
            if (legacy && (legacy.articles?.length > 0 || legacy.actions?.length > 0)) {
              set((state) => {
                state.articles = legacy.articles || [];
                state.actions = legacy.actions || [];
                state.wikiPageTypes = legacy.wikiPageTypes || '';
                state.wikiMultiScopeRules = legacy.wikiMultiScopeRules || '';
                state.wikiLintDimensions = legacy.wikiLintDimensions || '';
                state.industryConfigs = legacy.industryConfigs || {};
              });
              loadedFromCloud = true;
            }
          } catch {
            // ignore
          }
        }

        // Final offline fallback: localStorage backup
        if (!loadedFromCloud) {
          const localItem = localStorage.getItem(LOCAL_BACKUP_KEY);
          if (localItem) {
            try {
              const parsed = JSON.parse(localItem);
              set((state) => {
                state.articles = parsed.articles || [];
                state.actions = parsed.actions || [];
                state.wikiPageTypes = parsed.wikiPageTypes || '';
                state.wikiMultiScopeRules = parsed.wikiMultiScopeRules || '';
                state.wikiLintDimensions = parsed.wikiLintDimensions || '';
                state.industryConfigs = parsed.industryConfigs || {};
              });
            } catch (e) {
              console.warn('Failed to parse localStorage backup', e);
            }
          }
        }
      } catch (e) {
        console.error('Failed to load wiki data completely', e);
      }
    },

    // ─── Persistence primitives ──────────────────────────────

    saveSettings: () => {
      const state = get();
      const payload = {
        wikiPageTypes: state.wikiPageTypes,
        wikiMultiScopeRules: state.wikiMultiScopeRules,
        wikiLintDimensions: state.wikiLintDimensions,
        industryConfigs: state.industryConfigs,
      };
      // Fire-and-forget
      wikiSettingsApi.save(payload).catch((e) =>
        console.error('Failed to save wiki settings to cloud', e)
      );
      // Mirror into local backup
      writeLocalBackup(state);
    },

    saveBundle: (topLevelIndustry: string) => {
      const state = get();
      const articles = state.articles.filter(
        (a) => topLevelOf(a.industryCategory) === topLevelIndustry
      );
      const actions = state.actions.filter(
        (a) => topLevelOf(a.industryCategory) === topLevelIndustry
      );
      // Fire-and-forget; on empty bundle we still PUT (represents "explicitly empty")
      wikiBundleApi.save(topLevelIndustry, { articles, actions }).catch((e) =>
        console.error(`Failed to save wiki bundle "${topLevelIndustry}" to cloud`, e)
      );
      writeLocalBackup(state);
    },

    // ─── Settings mutations ──────────────────────────────────

    setWikiPageTypes: (pageTypes: string) => {
      set((state) => {
        state.wikiPageTypes = pageTypes;
      });
      get().saveSettings();
    },

    setWikiMultiScopeRules: (rules: string) => {
      set((state) => {
        state.wikiMultiScopeRules = rules;
      });
      get().saveSettings();
    },

    setWikiLintDimensions: (dims: string) => {
      set((state) => {
        state.wikiLintDimensions = dims;
      });
      get().saveSettings();
    },

    setIndustryConfig: (industryCategory: string, config: Partial<IndustryWikiConfig>) => {
      set((state) => {
        const existing = state.industryConfigs[industryCategory] || { customInstructions: '' };
        state.industryConfigs[industryCategory] = { ...existing, ...config };
      });
      get().saveSettings();
    },

    getIndustryConfig: (industryCategory: string): IndustryWikiConfig => {
      return get().industryConfigs[industryCategory] || { customInstructions: '' };
    },

    // ─── Article CRUD (per-industry bundle save) ─────────────

    addArticle: (industryCategory, title, content, tags = [], description = '') => {
      const id = generateId();
      set((state) => {
        state.articles.push({
          id,
          industryCategory,
          title,
          description,
          content,
          tags,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
      get().logAction(industryCategory, 'create', title, 'Initial creation');
      get().saveBundle(topLevelOf(industryCategory));
      return id;
    },

    updateArticle: (articleId, content, title, description) => {
      let affected = '';
      set((state) => {
        const article = state.articles.find((a) => a.id === articleId);
        if (article) {
          article.content = content;
          if (title) article.title = title;
          if (description) article.description = description;
          article.updatedAt = Date.now();
          affected = topLevelOf(article.industryCategory);
        }
      });
      if (affected) get().saveBundle(affected);
    },

    deleteArticle: (articleId) => {
      let category = '';
      let title = '';
      set((state) => {
        const article = state.articles.find((a) => a.id === articleId);
        if (article) {
          category = article.industryCategory;
          title = article.title;
          state.articles = state.articles.filter((a) => a.id !== articleId);
        }
      });
      if (category) {
        get().logAction(category, 'delete', title, 'Deleted manually or via lint');
        get().saveBundle(topLevelOf(category));
      }
    },

    clearCategoryArticles: (industryCategory) => {
      const top = topLevelOf(industryCategory);
      const isTopLevelClear =
        !industryCategory.includes('::') && industryCategory === top;

      const matching = get().articles.filter(
        (a) =>
          a.industryCategory === industryCategory ||
          a.industryCategory.startsWith(industryCategory + '::')
      );
      if (matching.length === 0 && !isTopLevelClear) return;

      set((state) => {
        state.articles = state.articles.filter(
          (a) =>
            a.industryCategory !== industryCategory &&
            !a.industryCategory.startsWith(industryCategory + '::')
        );
        state.actions = state.actions.filter(
          (a) =>
            a.industryCategory !== industryCategory &&
            !a.industryCategory.startsWith(industryCategory + '::')
        );
      });

      if (isTopLevelClear) {
        // Nuke the whole bundle file (cleaner than PUT-ing an empty one)
        wikiBundleApi.delete(top).catch((e) =>
          console.error(`Failed to delete wiki bundle "${top}"`, e)
        );
        writeLocalBackup(get());
      } else {
        // Sub-scope clear: save the (now-smaller) parent bundle
        get().saveBundle(top);
      }
    },

    logAction: (industryCategory, action, articleTitle, description) => {
      set((state) => {
        state.actions.unshift({
          id: generateId(),
          industryCategory,
          action,
          articleTitle,
          description,
          timestamp: Date.now(),
        });
        // Cap global action log to avoid unbounded growth (500 most recent)
        if (state.actions.length > 500) {
          state.actions = state.actions.slice(0, 500);
        }
      });
      // Note: individual action logs are saved as part of the next bundle save
      // triggered by the surrounding mutation (addArticle/updateArticle/deleteArticle).
      // If a caller invokes logAction standalone, persist the affected bundle now.
      get().saveBundle(topLevelOf(industryCategory));
    },
  }))
);

// ─── Local backup (offline-dev fallback only) ────────────────
function writeLocalBackup(state: IndustryWikiState) {
  try {
    localStorage.setItem(
      LOCAL_BACKUP_KEY,
      JSON.stringify({
        articles: state.articles,
        actions: state.actions,
        wikiPageTypes: state.wikiPageTypes,
        wikiMultiScopeRules: state.wikiMultiScopeRules,
        wikiLintDimensions: state.wikiLintDimensions,
        industryConfigs: state.industryConfigs,
      })
    );
  } catch {
    // quota exceeded or disabled — safe to ignore
  }
}
