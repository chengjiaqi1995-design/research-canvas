import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { aiApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { AIPanel, AIModel } from '../types/index.ts';

interface AIResearchState {
    // View mode
    viewMode: 'canvas' | 'ai_research';
    setViewMode: (mode: 'canvas' | 'ai_research') => void;

    // Panels
    panels: AIPanel[];
    addPanel: (defaultModel?: string) => void;
    removePanel: (id: string) => void;
    updatePanel: (id: string, updates: Partial<AIPanel>) => void;
    togglePanelSelection: (id: string) => void;
    selectAllPanels: (selected: boolean) => void;

    // AI Models (cached from server)
    models: AIModel[];
    loadModels: () => Promise<void>;

    // Streaming
    sendMessage: (panelId: string) => Promise<void>;
    stopStreaming: (panelId: string) => void;

    // Abort controllers for active streams
    _abortControllers: Map<string, AbortController>;
}

export const useAIResearchStore = create<AIResearchState>()(
    immer((set, get) => ({
        viewMode: 'canvas',
        panels: [],
        models: [],
        _abortControllers: new Map(),

        setViewMode: (mode) => {
            set((state) => {
                state.viewMode = mode;
            });
        },

        addPanel: (defaultModel) => {
            const panelCount = get().panels.length;
            set((state) => {
                state.panels.push({
                    id: generateId(),
                    title: `问题 ${panelCount + 1}`,
                    model: defaultModel || state.models[0]?.id || 'claude-3-5-sonnet-20241022',
                    prompt: '',
                    response: '',
                    editedResponse: '',
                    isStreaming: false,
                    selected: true,
                });
            });
        },

        removePanel: (id) => {
            // Abort any active stream
            const ctrl = get()._abortControllers.get(id);
            if (ctrl) ctrl.abort();
            set((state) => {
                state.panels = state.panels.filter((p) => p.id !== id);
                state._abortControllers.delete(id);
            });
        },

        updatePanel: (id, updates) => {
            set((state) => {
                const panel = state.panels.find((p) => p.id === id);
                if (panel) {
                    Object.assign(panel, updates);
                }
            });
        },

        togglePanelSelection: (id) => {
            set((state) => {
                const panel = state.panels.find((p) => p.id === id);
                if (panel) panel.selected = !panel.selected;
            });
        },

        selectAllPanels: (selected) => {
            set((state) => {
                state.panels.forEach((p) => (p.selected = selected));
            });
        },

        loadModels: async () => {
            try {
                const models = await aiApi.getModels();
                set((state) => {
                    state.models = models as AIModel[];
                });
            } catch (err) {
                console.error('Failed to load AI models:', err);
            }
        },

        sendMessage: async (panelId) => {
            const panel = get().panels.find((p) => p.id === panelId);
            if (!panel || !panel.prompt.trim()) return;

            // Abort previous stream if exists
            const existingCtrl = get()._abortControllers.get(panelId);
            if (existingCtrl) existingCtrl.abort();

            const abortController = new AbortController();
            set((state) => {
                const p = state.panels.find((p) => p.id === panelId);
                if (p) {
                    p.isStreaming = true;
                    p.response = '';
                    p.editedResponse = '';
                }
                state._abortControllers.set(panelId, abortController);
            });

            try {
                const stream = aiApi.chatStream({
                    model: panel.model,
                    messages: [{ role: 'user', content: panel.prompt }],
                    systemPrompt: panel.systemPrompt,
                });

                for await (const event of stream) {
                    // Check if aborted
                    if (abortController.signal.aborted) break;

                    if (event.type === 'text' && event.content) {
                        set((state) => {
                            const p = state.panels.find((p) => p.id === panelId);
                            if (p) {
                                p.response += event.content;
                                p.editedResponse = p.response; // Keep in sync during streaming
                            }
                        });
                    } else if (event.type === 'error') {
                        set((state) => {
                            const p = state.panels.find((p) => p.id === panelId);
                            if (p) {
                                p.response += `\n\n**Error:** ${event.content}`;
                                p.editedResponse = p.response;
                            }
                        });
                    } else if (event.type === 'done') {
                        // Streaming complete
                    }
                }
            } catch (err: unknown) {
                if ((err as Error).name !== 'AbortError') {
                    set((state) => {
                        const p = state.panels.find((p) => p.id === panelId);
                        if (p) {
                            p.response += `\n\n**Error:** ${(err as Error).message}`;
                            p.editedResponse = p.response;
                        }
                    });
                }
            } finally {
                set((state) => {
                    const p = state.panels.find((p) => p.id === panelId);
                    if (p) p.isStreaming = false;
                    state._abortControllers.delete(panelId);
                });
            }
        },

        stopStreaming: (panelId) => {
            const ctrl = get()._abortControllers.get(panelId);
            if (ctrl) ctrl.abort();
        },
    }))
);
