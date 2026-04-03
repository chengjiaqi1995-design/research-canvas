import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { trackerApi } from '../db/apiClient.ts';
import type { Tracker, TrackerInboxItem } from '../types/index.ts';

interface TrackerState {
  trackers: Tracker[];
  inboxItems: TrackerInboxItem[];
  isLoading: boolean;
  
  // Actions
  loadData: () => Promise<void>;
  
  // Tracker Actions
  addOrUpdateTracker: (tracker: Tracker) => Promise<void>;
  deleteTracker: (id: string) => Promise<void>;
  
  // Inbox Actions
  addInboxItem: (item: TrackerInboxItem) => Promise<void>;
  removeInboxItem: (id: string) => Promise<void>;
}

export const useTrackerStore = create<TrackerState>()(
  immer((set, get) => ({
    trackers: [],
    inboxItems: [
      {
        id: 'mock-1',
        source: 'crawler',
        content: '分析师预计，MTU Aero Engines 第二季度营业利润将达到 1.8 亿欧元，这主要得益于商用零配件的强劲反弹...',
        targetCompany: '[MTX GR] MTU Aero Engines',
        targetMetric: 'Q2 预期营业利润 (百万元)',
        extractedValue: 180.0,
        timePeriod: '2026-Q2',
        timestamp: Date.now() - 600000,
      }
    ], // keep one mock item just for initial UI fallback if empty but will be overwritten by loadData
    isLoading: false,

    loadData: async () => {
      set({ isLoading: true });
      try {
        const [trackers, inboxItems] = await Promise.all([
          trackerApi.getTrackers(),
          trackerApi.getInbox()
        ]);
        set((state) => {
          state.trackers = trackers;
          if (inboxItems.length > 0) {
            state.inboxItems = inboxItems;
          }
        });
      } catch (err) {
        console.error('Failed to load tracker data', err);
      } finally {
        set({ isLoading: false });
      }
    },

    addOrUpdateTracker: async (tracker: Tracker) => {
      try {
        await trackerApi.saveTrackers([tracker]);
        set((state) => {
          const idx = state.trackers.findIndex(t => t.id === tracker.id);
          if (idx !== -1) state.trackers[idx] = tracker;
          else state.trackers.push(tracker);
        });
      } catch (err) {
        console.error('Failed to update tracker', err);
      }
    },

    deleteTracker: async (id: string) => {
      try {
        await trackerApi.deleteTracker(id);
        set((state) => {
          state.trackers = state.trackers.filter(t => t.id !== id);
        });
      } catch (err) {
        console.error('Failed to delete tracker', err);
      }
    },

    addInboxItem: async (item: TrackerInboxItem) => {
      try {
        await trackerApi.addInbox(item);
        set((state) => {
          state.inboxItems.unshift(item);
        });
      } catch (err) {
        console.error('Failed to add inbox item', err);
      }
    },

    removeInboxItem: async (id: string) => {
      try {
        await trackerApi.deleteInbox(id);
        set((state) => {
          state.inboxItems = state.inboxItems.filter(i => i.id !== id);
        });
      } catch (err) {
        console.error('Failed to remove inbox item', err);
        // Optimistic UI Fallback in case of mock data erroring out on API
        set((state) => {
          state.inboxItems = state.inboxItems.filter(i => i.id !== id);
        });
      }
    }
  }))
);
