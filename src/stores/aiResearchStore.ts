import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { aiApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { AIPanel, AIModel } from '../types/index.ts';

const DEFAULT_PROMPT = `请分析以下问题，确保回答准确、结构清晰：
- 使用 Markdown 格式组织输出
- 如包含数据，请尽量以表格展示
- 分析时请给出逻辑推理过程

[在此输入你的具体问题]`;

const FIXED_SYSTEM_PROMPT = '你是一位专业的研究助理，擅长深度分析和数据整理。请用中文回答。';

// Keep abort controllers outside immer (Map is not natively supported by immer)
const abortControllers = new Map<string, AbortController>();

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
}

export const useAIResearchStore = create<AIResearchState>()(
    persist(
        immer((set, get) => ({
            viewMode: 'canvas' as const,
            panels: [] as AIPanel[],
            models: [] as AIModel[],

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
                        model: defaultModel || state.models[0]?.id || 'gemini-2.5-flash',
                        prompt: DEFAULT_PROMPT,
                        response: '',
                        editedResponse: '',
                        isStreaming: false,
                        systemPrompt: FIXED_SYSTEM_PROMPT,
                        selected: true,
                    });
                });
            },

            removePanel: (id) => {
                // Abort any active stream
                const ctrl = abortControllers.get(id);
                if (ctrl) ctrl.abort();
                abortControllers.delete(id);
                set((state) => {
                    state.panels = state.panels.filter((p) => p.id !== id);
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
                console.log('[AI] sendMessage called, panelId:', panelId);
                const panel = get().panels.find((p) => p.id === panelId);
                if (!panel) { console.log('[AI] panel not found'); return; }
                if (!panel.prompt.trim()) { console.log('[AI] prompt is empty'); return; }
                console.log('[AI] panel found, model:', panel.model, 'prompt length:', panel.prompt.length);

                // Abort previous stream if exists
                const existingCtrl = abortControllers.get(panelId);
                if (existingCtrl) existingCtrl.abort();

                const abortController = new AbortController();
                abortControllers.set(panelId, abortController);

                set((state) => {
                    const p = state.panels.find((p) => p.id === panelId);
                    if (p) {
                        p.isStreaming = true;
                        p.response = '';
                        p.editedResponse = '';
                    }
                });
                console.log('[AI] isStreaming set to true, starting fetch...');

                try {
                    const stream = aiApi.chatStream({
                        model: panel.model,
                        messages: [{ role: 'user', content: panel.prompt }],
                        systemPrompt: panel.systemPrompt,
                    });
                    console.log('[AI] chatStream generator created, starting iteration...');

                    for await (const event of stream) {
                        // Check if aborted
                        if (abortController.signal.aborted) break;

                        if (event.type === 'text' && event.content) {
                            set((state) => {
                                const p = state.panels.find((p) => p.id === panelId);
                                if (p) {
                                    p.response += event.content;
                                    p.editedResponse = p.response;
                                }
                            });
                        } else if (event.type === 'error') {
                            console.error('[AI] SSE error event:', event.content);
                            set((state) => {
                                const p = state.panels.find((p) => p.id === panelId);
                                if (p) {
                                    p.response += `\n\n**Error:** ${event.content}`;
                                    p.editedResponse = p.response;
                                }
                            });
                        } else if (event.type === 'done') {
                            console.log('[AI] Stream done');
                        }
                    }
                } catch (err: unknown) {
                    console.error('[AI] sendMessage catch:', err);
                    if ((err as Error).name !== 'AbortError') {
                        const errMsg = (err as Error).message;
                        set((state) => {
                            const p = state.panels.find((p) => p.id === panelId);
                            if (p) {
                                p.response = `**错误:** ${errMsg}`;
                                p.editedResponse = p.response;
                            }
                        });
                    }
                } finally {
                    abortControllers.delete(panelId);
                    set((state) => {
                        const p = state.panels.find((p) => p.id === panelId);
                        if (p) p.isStreaming = false;
                    });
                    console.log('[AI] sendMessage finished');
                }
            },

            stopStreaming: (panelId) => {
                const ctrl = abortControllers.get(panelId);
                if (ctrl) ctrl.abort();
            },
        })),
        {
            name: 'rc-ai-research',
            partialize: (state) => ({
                viewMode: state.viewMode,
                panels: state.panels.map((p) => ({
                    ...p,
                    isStreaming: false, // Reset streaming state on restore
                })),
            }),
        }
    )
);
