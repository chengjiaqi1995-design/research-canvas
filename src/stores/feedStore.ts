import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { feedApi } from '../db/apiClient.ts';
import type { FeedItem, FeedLabeledStat, FeedListMeta, FeedTypeStat } from '../db/apiClient.ts';
import { getFeedCategoryLabel, getFeedReportTypeOption } from '../feed/feedItemModel.ts';

interface FeedFilters {
  type?: string;
  reportType?: string;
  isRead?: string;
  isStarred?: string;
  category?: string;
}

interface FeedState {
  items: FeedItem[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  filters: FeedFilters;
  categories: string[]; // distinct categories for filter UI
  reportTypes: Array<{ value: string; label: string }>;
  typeStats: FeedTypeStat[];
  categoryStats: FeedLabeledStat[];
  reportTypeStats: FeedLabeledStat[];

  loadFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
  setFilter: (f: Partial<FeedFilters>) => void;
  clearFilters: () => void;
  toggleRead: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  removeFeedItem: (id: string) => Promise<void>;
}

function categoryValueForItem(item: FeedItem) {
  return getFeedCategoryLabel(item) || item.category || '';
}

function reportTypeForItem(item: FeedItem) {
  return getFeedReportTypeOption(item);
}

function deriveFeedMeta(items: FeedItem[]): FeedListMeta {
  const types = new Map<string, FeedTypeStat>();
  const categories = new Map<string, FeedLabeledStat>();
  const reportTypes = new Map<string, FeedLabeledStat>();

  const bump = <T extends { total: number; unread: number }>(stat: T, item: FeedItem) => {
    stat.total += 1;
    if (!item.isRead) stat.unread += 1;
  };

  for (const item of items) {
    const typeStat = types.get(item.type) || { value: item.type, total: 0, unread: 0 };
    bump(typeStat, item);
    types.set(item.type, typeStat);

    const category = categoryValueForItem(item);
    if (category) {
      const categoryStat = categories.get(category) || { value: category, label: category, total: 0, unread: 0 };
      bump(categoryStat, item);
      categories.set(category, categoryStat);
    }

    const reportType = reportTypeForItem(item);
    if (reportType) {
      const reportStat = reportTypes.get(reportType.value) || { ...reportType, total: 0, unread: 0 };
      reportStat.label = reportType.label;
      bump(reportStat, item);
      reportTypes.set(reportType.value, reportStat);
    }
  }

  return {
    types: Array.from(types.values()).sort((a, b) => a.value.localeCompare(b.value)),
    categories: Array.from(categories.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')),
    reportTypes: Array.from(reportTypes.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')),
  };
}

function applyFeedMeta(state: FeedState, meta: FeedListMeta) {
  state.typeStats = meta.types || [];
  state.categoryStats = meta.categories || [];
  state.reportTypeStats = meta.reportTypes || [];
  state.categories = state.categoryStats.map((item) => item.value);
  state.reportTypes = state.reportTypeStats.map((item) => ({ value: item.value, label: item.label }));
}

function adjustStats(stats: Array<FeedTypeStat | FeedLabeledStat>, value: string, totalDelta: number, unreadDelta: number) {
  const stat = stats.find((item) => item.value === value);
  if (!stat) return;
  stat.total = Math.max(0, stat.total + totalDelta);
  stat.unread = Math.max(0, stat.unread + unreadDelta);
}

function adjustItemStats(state: FeedState, item: FeedItem, totalDelta: number, unreadDelta: number) {
  adjustStats(state.typeStats, item.type, totalDelta, unreadDelta);
  const category = categoryValueForItem(item);
  if (category) adjustStats(state.categoryStats, category, totalDelta, unreadDelta);
  const reportType = reportTypeForItem(item);
  if (reportType) adjustStats(state.reportTypeStats, reportType.value, totalDelta, unreadDelta);
}

let feedListRequestId = 0;

export const useFeedStore = create<FeedState>()(
  immer((set, get) => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    isLoading: false,
    filters: {},
    categories: [],
    reportTypes: [],
    typeStats: [],
    categoryStats: [],
    reportTypeStats: [],

    loadFeed: async () => {
      const requestId = ++feedListRequestId;
      set((s) => { s.isLoading = true; s.page = 1; });
      try {
        const { filters, pageSize } = get();
        const res = await feedApi.list({ ...filters, page: 1, pageSize });
        if (requestId !== feedListRequestId) return;
        set((s) => {
          s.items = res.data;
          s.total = res.total;
          s.isLoading = false;
          applyFeedMeta(s, res.meta || deriveFeedMeta(res.data));
        });
      } catch (err) {
        console.error('Failed to load feed:', err);
        if (requestId === feedListRequestId) {
          set((s) => { s.isLoading = false; });
        }
      }
    },

    loadMore: async () => {
      const { items, total, page, pageSize, filters, isLoading } = get();
      if (isLoading || items.length >= total) return;
      const requestId = ++feedListRequestId;
      const nextPage = page + 1;
      set((s) => { s.isLoading = true; });
      try {
        const res = await feedApi.list({ ...filters, page: nextPage, pageSize });
        if (requestId !== feedListRequestId) return;
        set((s) => {
          s.items.push(...res.data);
          s.page = nextPage;
          s.total = res.total;
          s.isLoading = false;
          applyFeedMeta(s, res.meta || deriveFeedMeta(s.items));
        });
      } catch {
        if (requestId === feedListRequestId) {
          set((s) => { s.isLoading = false; });
        }
      }
    },

    setFilter: (f) => {
      set((s) => { Object.assign(s.filters, f); });
      get().loadFeed();
    },

    clearFilters: () => {
      set((s) => { s.filters = {}; });
      get().loadFeed();
    },

    toggleRead: async (id) => {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const newVal = !item.isRead;
      // Optimistic update
      set((s) => {
        const idx = s.items.findIndex((i) => i.id === id);
        if (idx >= 0) {
          s.items[idx].isRead = newVal;
          adjustItemStats(s, item, 0, newVal ? -1 : 1);
        }
      });
      try {
        await feedApi.update(id, { isRead: newVal });
      } catch {
        // Revert
        set((s) => {
          const idx = s.items.findIndex((i) => i.id === id);
          if (idx >= 0) {
            s.items[idx].isRead = !newVal;
            adjustItemStats(s, item, 0, newVal ? 1 : -1);
          }
        });
      }
    },

    toggleStar: async (id) => {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const newVal = !item.isStarred;
      set((s) => {
        const idx = s.items.findIndex((i) => i.id === id);
        if (idx >= 0) s.items[idx].isStarred = newVal;
      });
      try {
        await feedApi.update(id, { isStarred: newVal });
      } catch {
        set((s) => {
          const idx = s.items.findIndex((i) => i.id === id);
          if (idx >= 0) s.items[idx].isStarred = !newVal;
        });
      }
    },

    markAllRead: async () => {
      const { filters } = get();
      try {
        await feedApi.markAllRead(filters.type);
        await get().loadFeed();
      } catch (err) {
        console.error('Failed to mark all read:', err);
      }
    },

    removeFeedItem: async (id) => {
      const backup = get().items.find((i) => i.id === id);
      const backupIndex = get().items.findIndex((i) => i.id === id);
      set((s) => {
        s.items = s.items.filter((i) => i.id !== id);
        s.total = Math.max(0, s.total - 1);
        if (backup) adjustItemStats(s, backup, -1, backup.isRead ? 0 : -1);
      });
      try {
        await feedApi.remove(id);
      } catch {
        if (backup) set((s) => {
          const restoreIndex = backupIndex >= 0 ? backupIndex : s.items.length;
          s.items.splice(restoreIndex, 0, backup);
          s.total += 1;
          adjustItemStats(s, backup, 1, backup.isRead ? 0 : 1);
        });
      }
    },
  }))
);
