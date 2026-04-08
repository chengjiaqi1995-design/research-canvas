import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { feedApi } from '../db/apiClient.ts';
import type { FeedItem } from '../db/apiClient.ts';

interface FeedFilters {
  type?: string;
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

  loadFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
  setFilter: (f: Partial<FeedFilters>) => void;
  clearFilters: () => void;
  toggleRead: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  removeFeedItem: (id: string) => Promise<void>;
}

export const useFeedStore = create<FeedState>()(
  immer((set, get) => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    isLoading: false,
    filters: {},
    categories: [],

    loadFeed: async () => {
      set((s) => { s.isLoading = true; s.page = 1; });
      try {
        const { filters, pageSize } = get();
        const res = await feedApi.list({ ...filters, page: 1, pageSize });
        set((s) => {
          s.items = res.data;
          s.total = res.total;
          s.isLoading = false;
          // Extract unique categories
          const cats = new Set<string>();
          for (const item of res.data) {
            if (item.category) cats.add(item.category);
          }
          s.categories = Array.from(cats).sort();
        });
      } catch (err) {
        console.error('Failed to load feed:', err);
        set((s) => { s.isLoading = false; });
      }
    },

    loadMore: async () => {
      const { items, total, page, pageSize, filters, isLoading } = get();
      if (isLoading || items.length >= total) return;
      const nextPage = page + 1;
      set((s) => { s.isLoading = true; });
      try {
        const res = await feedApi.list({ ...filters, page: nextPage, pageSize });
        set((s) => {
          s.items.push(...res.data);
          s.page = nextPage;
          s.total = res.total;
          s.isLoading = false;
        });
      } catch {
        set((s) => { s.isLoading = false; });
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
        if (idx >= 0) s.items[idx].isRead = newVal;
      });
      try {
        await feedApi.update(id, { isRead: newVal });
      } catch {
        // Revert
        set((s) => {
          const idx = s.items.findIndex((i) => i.id === id);
          if (idx >= 0) s.items[idx].isRead = !newVal;
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
        set((s) => {
          for (const item of s.items) {
            if (!filters.type || item.type === filters.type) {
              item.isRead = true;
            }
          }
        });
      } catch (err) {
        console.error('Failed to mark all read:', err);
      }
    },

    removeFeedItem: async (id) => {
      const backup = get().items.find((i) => i.id === id);
      set((s) => {
        s.items = s.items.filter((i) => i.id !== id);
        s.total -= 1;
      });
      try {
        await feedApi.remove(id);
      } catch {
        if (backup) set((s) => { s.items.push(backup); s.total += 1; });
      }
    },
  }))
);
