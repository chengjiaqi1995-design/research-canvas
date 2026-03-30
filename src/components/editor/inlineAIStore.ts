import { create } from 'zustand';

interface StreamingState {
  isStreaming: boolean;
  abortController: AbortController | null;
  content: string; // accumulated content during streaming
}

interface InlineAIStore {
  streamingBlocks: Map<string, StreamingState>;
  startStreaming: (blockId: string) => AbortController;
  appendContent: (blockId: string, chunk: string) => void;
  getContent: (blockId: string) => string;
  stopStreaming: (blockId: string) => void;
  isStreaming: (blockId: string) => boolean;
  abortAll: () => void;
}

export const useInlineAIStore = create<InlineAIStore>((set, get) => ({
  streamingBlocks: new Map(),

  startStreaming: (blockId: string) => {
    const existing = get().streamingBlocks.get(blockId);
    if (existing?.abortController) {
      existing.abortController.abort();
    }
    const controller = new AbortController();
    set((state) => {
      const next = new Map(state.streamingBlocks);
      next.set(blockId, { isStreaming: true, abortController: controller, content: '' });
      return { streamingBlocks: next };
    });
    return controller;
  },

  appendContent: (blockId: string, chunk: string) => {
    set((state) => {
      const next = new Map(state.streamingBlocks);
      const entry = next.get(blockId);
      if (entry) {
        next.set(blockId, { ...entry, content: entry.content + chunk });
      }
      return { streamingBlocks: next };
    });
  },

  getContent: (blockId: string) => {
    return get().streamingBlocks.get(blockId)?.content || '';
  },

  stopStreaming: (blockId: string) => {
    set((state) => {
      const next = new Map(state.streamingBlocks);
      const entry = next.get(blockId);
      if (entry) {
        next.set(blockId, { ...entry, isStreaming: false, abortController: null });
      }
      return { streamingBlocks: next };
    });
  },

  isStreaming: (blockId: string) => {
    return get().streamingBlocks.get(blockId)?.isStreaming || false;
  },

  abortAll: () => {
    const blocks = get().streamingBlocks;
    blocks.forEach((state) => {
      if (state.abortController) state.abortController.abort();
    });
    set({ streamingBlocks: new Map() });
  },
}));
