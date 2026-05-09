import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  assistantApi,
  type AssistantContext,
  type AssistantExternalSourceKey,
  type AssistantMode,
  type AssistantScope,
  type AssistantSource,
  type AssistantSourceKey,
  type AssistantToolStatus,
} from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  sources?: AssistantSource[];
  tools?: AssistantToolStatus[];
  error?: string;
}

const DEFAULT_SOURCES: AssistantSourceKey[] = [
  'canvas',
  'ai_process',
  'portfolio',
  'tracker',
  'feed',
  'ai_library',
  'overview',
];

let activeAbortController: AbortController | null = null;

interface AssistantState {
  isOpen: boolean;
  mode: AssistantMode;
  scope: AssistantScope;
  enabledSources: AssistantSourceKey[];
  externalSources: AssistantExternalSourceKey[];
  deepAnalysis: boolean;
  messages: AssistantMessage[];
  isStreaming: boolean;
  tools: AssistantToolStatus[];
  sources: AssistantSource[];
  error: string | null;

  open: () => void;
  close: () => void;
  toggle: () => void;
  setMode: (mode: AssistantMode) => void;
  setScope: (scope: AssistantScope) => void;
  setDeepAnalysis: (enabled: boolean) => void;
  toggleSource: (source: AssistantSourceKey) => void;
  toggleExternalSource: (source: AssistantExternalSourceKey) => void;
  clear: () => void;
  stop: () => void;
  sendMessage: (query: string, context?: AssistantContext) => Promise<void>;
}

function compactMessages(messages: AssistantMessage[]) {
  return messages.slice(-60);
}

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      mode: 'qa',
      scope: 'current',
      enabledSources: DEFAULT_SOURCES,
      externalSources: [],
      deepAnalysis: false,
      messages: [],
      isStreaming: false,
      tools: [],
      sources: [],
      error: null,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setMode: (mode) => set({ mode }),
      setScope: (scope) => set({ scope }),
      setDeepAnalysis: (deepAnalysis) => set({ deepAnalysis }),
      toggleSource: (source) => set((state) => {
        const exists = state.enabledSources.includes(source);
        const next = exists
          ? state.enabledSources.filter((item) => item !== source)
          : [...state.enabledSources, source];
        return { enabledSources: next.length ? next : [source] };
      }),
      toggleExternalSource: (source) => set((state) => {
        const exists = state.externalSources.includes(source);
        return {
          externalSources: exists
            ? state.externalSources.filter((item) => item !== source)
            : [...state.externalSources, source],
        };
      }),
      clear: () => set({ messages: [], tools: [], sources: [], error: null }),
      stop: () => {
        activeAbortController?.abort();
        activeAbortController = null;
        set({ isStreaming: false });
      },

      sendMessage: async (rawQuery, context) => {
        const query = rawQuery.trim();
        if (!query || get().isStreaming) return;

        const userMessage: AssistantMessage = {
          id: generateId(),
          role: 'user',
          content: query,
          createdAt: Date.now(),
        };
        const assistantMessage: AssistantMessage = {
          id: generateId(),
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          sources: [],
          tools: [],
        };

        activeAbortController = new AbortController();
        set((state) => ({
          messages: compactMessages([...state.messages, userMessage, assistantMessage]),
          isStreaming: true,
          tools: [],
          sources: [],
          error: null,
        }));

        const updateAssistant = (patch: Partial<AssistantMessage>) => {
          set((state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantMessage.id ? { ...message, ...patch } : message
            ),
          }));
        };

        try {
          for await (const event of assistantApi.chatStream({
            query,
            mode: get().deepAnalysis ? 'analysis' : 'qa',
            scope: get().scope,
            sources: get().enabledSources,
            externalSources: get().externalSources,
            deep: get().deepAnalysis,
            context,
          }, activeAbortController.signal)) {
            if (event.type === 'tools') {
              set({ tools: event.tools });
              updateAssistant({ tools: event.tools });
            } else if (event.type === 'sources') {
              set({ sources: event.sources });
              updateAssistant({ sources: event.sources });
            } else if (event.type === 'text') {
              const current = get().messages.find((message) => message.id === assistantMessage.id);
              updateAssistant({ content: `${current?.content || ''}${event.content}` });
            } else if (event.type === 'error') {
              set({ error: event.content });
              updateAssistant({ error: event.content, content: event.content });
            } else if (event.type === 'done') {
              break;
            }
          }
        } catch (error: any) {
          if (error?.name !== 'AbortError') {
            const message = error?.message || 'Assistant 请求失败';
            set({ error: message });
            updateAssistant({ error: message, content: message });
          }
        } finally {
          activeAbortController = null;
          set({ isStreaming: false });
        }
      },
    }),
    {
      name: 'rc_assistant_state',
      partialize: (state) => ({
        mode: state.mode,
        scope: state.scope,
        enabledSources: state.enabledSources,
        externalSources: state.externalSources,
        deepAnalysis: state.deepAnalysis,
        messages: compactMessages(state.messages),
      }),
    }
  )
);
