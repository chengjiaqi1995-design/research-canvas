import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { aiApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { AIModel, AICardNodeData, PromptTemplate, AISkill, FormatTemplate } from '../types/index.ts';

// Keep abort controllers outside immer (Map is not natively supported by immer)
const abortControllers = new Map<string, AbortController>();

export interface AICard extends AICardNodeData {
    id: string;
}

interface AICardStoreState {
    // View mode
    viewMode: 'canvas' | 'ai_research' | 'ai_process' | 'portfolio' | 'tracker';
    setViewMode: (mode: 'canvas' | 'ai_research' | 'ai_process' | 'portfolio' | 'tracker') => void;

    // Cards
    cards: AICard[];
    selectedCardId: string | null;
    addCard: (initial?: Partial<Pick<AICard, 'title' | 'prompt'>>) => void;
    removeCard: (id: string) => void;
    updateCard: (id: string, updates: Partial<AICardNodeData>) => void;
    selectCard: (id: string | null) => void;

    // AI Card streaming helpers
    appendCardContent: (cardId: string, chunk: string) => void;
    setCardStreaming: (cardId: string, streaming: boolean) => void;

    // AI Models (cached from server)
    models: AIModel[];
    loadModels: () => Promise<void>;

    // Custom prompt templates
    customTemplates: PromptTemplate[];
    addCustomTemplate: (template: Omit<PromptTemplate, 'id'>) => void;
    updateCustomTemplate: (id: string, updates: Partial<PromptTemplate>) => void;
    removeCustomTemplate: (id: string) => void;

    // Skills (Methodology)
    skills: AISkill[];
    addSkill: (skill: Omit<AISkill, 'id' | 'createdAt'>) => void;
    updateSkill: (id: string, updates: Partial<AISkill>) => void;
    removeSkill: (id: string) => void;

    // Custom Formats
    customFormats: FormatTemplate[];
    addCustomFormat: (format: Omit<FormatTemplate, 'id'>) => void;
    updateCustomFormat: (id: string, updates: Partial<FormatTemplate>) => void;
    removeCustomFormat: (id: string) => void;

    // Sync helpers
    syncWithServer: () => Promise<void>;
    pushToServer: () => void;

    // Streaming
    sendMessage: (cardId: string) => Promise<void>;
    stopStreaming: (cardId: string) => void;
}

export const useAICardStore = create<AICardStoreState>()(
    persist(
        immer((set, get) => ({
            viewMode: 'canvas' as const,
            cards: [] as AICard[],
            selectedCardId: null as string | null,
            models: [] as AIModel[],
            customTemplates: [] as PromptTemplate[],
            skills: [] as AISkill[],
            customFormats: [] as FormatTemplate[],

            setViewMode: (mode) => {
                set((state) => {
                    state.viewMode = mode;
                });
            },

            addCard: (initial) => {
                const id = generateId();
                set((state) => {
                    state.cards.push({
                        id,
                        type: 'ai_card',
                        title: initial?.title || 'AI 卡片',
                        prompt: initial?.prompt || '',
                        config: {
                            model: state.models[0]?.id || 'gemini-2.5-flash',
                            sourceMode: 'notes',
                            sourceNodeIds: [],
                            outputFormat: 'markdown',
                            formatId: undefined,
                        },
                        generatedContent: '',
                        editedContent: '',
                        isStreaming: false,
                    });
                    state.selectedCardId = id;
                });
            },

            removeCard: (id) => {
                const ctrl = abortControllers.get(id);
                if (ctrl) ctrl.abort();
                abortControllers.delete(id);
                set((state) => {
                    state.cards = state.cards.filter((c) => c.id !== id);
                    if (state.selectedCardId === id) {
                        state.selectedCardId = state.cards.length > 0 ? state.cards[0].id : null;
                    }
                });
            },

            updateCard: (id, updates) => {
                set((state) => {
                    const card = state.cards.find((c) => c.id === id);
                    if (card) {
                        Object.assign(card, updates);
                    }
                });
            },

            selectCard: (id) => {
                set((state) => {
                    state.selectedCardId = id;
                });
            },

            appendCardContent: (cardId, chunk) => {
                set((state) => {
                    const card = state.cards.find((c) => c.id === cardId);
                    if (card) {
                        card.generatedContent += chunk;
                        card.editedContent = card.generatedContent;
                    }
                });
            },

            setCardStreaming: (cardId, streaming) => {
                set((state) => {
                    const card = state.cards.find((c) => c.id === cardId);
                    if (card) {
                        card.isStreaming = streaming;
                        if (!streaming) {
                            card.lastGeneratedAt = Date.now();
                        }
                    }
                });
            },

            addCustomTemplate: (template) => {
                set((state) => {
                    state.customTemplates.push({
                        ...template,
                        id: `custom_${generateId()}`,
                    });
                });
                get().pushToServer();
            },

            updateCustomTemplate: (id, updates) => {
                set((state) => {
                    const tpl = state.customTemplates.find((t) => t.id === id);
                    if (tpl) Object.assign(tpl, updates);
                });
                get().pushToServer();
            },

            removeCustomTemplate: (id) => {
                set((state) => {
                    state.customTemplates = state.customTemplates.filter((t) => t.id !== id);
                });
                get().pushToServer();
            },

            addSkill: (skill) => {
                const id = generateId();
                set((state) => {
                    state.skills.push({ ...skill, id, createdAt: Date.now() });
                });
                get().pushToServer();
            },

            updateSkill: (id, updates) => {
                set((state) => {
                    const skill = state.skills.find(s => s.id === id);
                    if (skill) Object.assign(skill, updates);
                });
                get().pushToServer();
            },

            removeSkill: (id) => {
                set((state) => {
                    state.skills = state.skills.filter(s => s.id !== id);
                    state.cards.forEach(c => {
                        if (c.config.skillId === id) delete c.config.skillId;
                    });
                });
                get().pushToServer();
            },

            addCustomFormat: (format) => {
                set((state) => {
                    state.customFormats.push({
                        ...format,
                        id: `format_${generateId()}`,
                    });
                });
                get().pushToServer();
            },

            updateCustomFormat: (id, updates) => {
                set((state) => {
                    const fmt = state.customFormats.find((f) => f.id === id);
                    if (fmt) Object.assign(fmt, updates);
                });
                get().pushToServer();
            },

            removeCustomFormat: (id) => {
                set((state) => {
                    state.customFormats = state.customFormats.filter((f) => f.id !== id);
                    state.cards.forEach(c => {
                        if (c.config.formatId === id) delete c.config.formatId;
                    });
                });
                get().pushToServer();
            },

            syncWithServer: async () => {
                try {
                    const settings = await aiApi.getSettings();
                    const serverSkills = settings.skills || [];
                    const serverTemplates = settings.customTemplates || [];
                    const serverFormats = settings.customFormats || [];
                    
                    set((state) => {
                        // Priority is given to server states. 
                        // If local has something that server doesn't (first launch after update), we will push them.
                        const localSkillsCount = state.skills.length;
                        const localTemplatesCount = state.customTemplates.length;
                        const localFormatsCount = state.customFormats.length;
                        
                        if (serverSkills.length > 0 || serverTemplates.length > 0 || serverFormats.length > 0) {
                            state.skills = serverSkills;
                            state.customTemplates = serverTemplates;
                            state.customFormats = serverFormats;
                        }
                        
                        // If it's a completely empty server but local has data, sync it upwards asynchronously
                        if ((serverSkills.length === 0 && localSkillsCount > 0) || 
                            (serverTemplates.length === 0 && localTemplatesCount > 0) ||
                            (serverFormats.length === 0 && localFormatsCount > 0)) {
                            setTimeout(() => {
                                get().pushToServer();
                            }, 100);
                        }
                    });
                } catch (e) {
                    console.error('Failed to sync templates/skills/formats with server:', e);
                }
            },

            pushToServer: () => {
                const { skills, customTemplates, customFormats } = get();
                aiApi.saveSettings({ skills, customTemplates, customFormats }).catch(e => {
                    console.error('Failed to push templates/skills/formats to server:', e);
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

            sendMessage: async (cardId) => {
                const card = get().cards.find((c) => c.id === cardId);
                if (!card || !card.prompt.trim()) return;

                // Abort previous stream if exists
                const existingCtrl = abortControllers.get(cardId);
                if (existingCtrl) existingCtrl.abort();

                const abortController = new AbortController();
                abortControllers.set(cardId, abortController);

                set((state) => {
                    const c = state.cards.find((c) => c.id === cardId);
                    if (c) {
                        c.isStreaming = true;
                        c.generatedContent = '';
                        c.editedContent = '';
                        c.error = undefined;
                    }
                });

                try {
                    // Build context from source
                    let context = '';
                    if (card.config.sourceMode !== 'web') {
                        const hasWs = card.config.sourceWorkspaceIds && card.config.sourceWorkspaceIds.length > 0;
                        const hasCanvas = card.config.sourceCanvasIds && card.config.sourceCanvasIds.length > 0;
                        const hasDateFilter = !!card.config.sourceDateFrom || !!card.config.sourceDateTo;
                        if (hasWs || hasCanvas || hasDateFilter) {
                            // Folder-based source: query notes from backend
                            const { notesApi } = await import('../db/apiClient.ts');
                            try {
                                const result = await notesApi.query(
                                    card.config.sourceWorkspaceIds || [],
                                    card.config.sourceCanvasIds || [],
                                    card.config.sourceDateFrom,
                                    card.config.sourceDateTo,
                                    card.config.sourceDateField,
                                );
                                context = result.notes
                                    .map((n) => `## ${n.title}\n${n.content}`)
                                    .join('\n\n---\n\n');
                            } catch (err) {
                                console.error('Failed to query folder notes:', err);
                            }
                        } else if (card.config.sourceNodeIds.length > 0) {
                            // Canvas node-based source (legacy)
                            const { useCanvasStore } = await import('./canvasStore.ts');
                            const allNodes = useCanvasStore.getState().nodes;
                            const sourceNodes = card.config.sourceNodeIds
                                .map((id) => allNodes.find((n) => n.id === id))
                                .filter(Boolean);
                            context = sourceNodes
                                .map((n) => `## ${n!.data.title}\n${extractNodeContent(n!.data as { type: string; title: string; content?: string; columns?: Array<{ name: string }>; rows?: Array<{ cells: Record<string, unknown> }> })}`)
                                .join('\n\n---\n\n');
                        }
                    }

                    let promptWithContext = card.prompt.includes('{context}')
                        ? card.prompt.replace('{context}', context || '（无提供内容）')
                        : context
                            ? `${card.prompt}\n\n---\n\n以下是参考资料：\n\n${context}`
                            : card.prompt;

                    if (card.config.skillId) {
                        const skill = get().skills.find(s => s.id === card.config.skillId);
                        if (skill) {
                            promptWithContext += `\n\n## 必须遵循的方法论 (Skill)\n以下是你处理任务时必须严格遵守的专属方法论框架：\n\n${skill.content}`;
                        }
                    }

                    if (card.config.formatId) {
                        const allFormats = [...(await import('../constants/formatTemplates.ts')).FORMAT_TEMPLATES, ...(get().customFormats || [])];
                        const format = allFormats.find(f => f.id === card.config.formatId);
                        if (format) {
                            promptWithContext += `\n\n## 必须遵循的输出格式 (Format)\n${format.content}`;
                        }
                    }

                    const systemPrompt = card.config.sourceMode === 'web'
                        ? '你是一位专业的研究助理。请搜索互联网获取最新公开数据来回答问题。引用数据时请标注来源。用中文回答。'
                        : card.config.sourceMode === 'notes_web'
                            ? '你是一位专业的研究助理。请结合提供的笔记资料和互联网公开数据进行分析。引用数据时请标注来源。用中文回答。'
                            : '你是一位专业的研究助理。请基于提供的资料进行分析。用中文回答。';

                    const isGemini = card.config.model.startsWith('gemini');
                    const tools = (card.config.sourceMode === 'web' || card.config.sourceMode === 'notes_web') && isGemini
                        ? [{ google_search: {} }]
                        : undefined;

                    const stream = aiApi.chatStream({
                        model: card.config.model,
                        messages: [{ role: 'user', content: promptWithContext }],
                        systemPrompt,
                        tools,
                    });

                    for await (const event of stream) {
                        if (abortController.signal.aborted) break;
                        if (event.type === 'text' && event.content) {
                            set((state) => {
                                const c = state.cards.find((c) => c.id === cardId);
                                if (c) {
                                    c.generatedContent += event.content;
                                    c.editedContent = c.generatedContent;
                                }
                            });
                        } else if (event.type === 'error') {
                            set((state) => {
                                const c = state.cards.find((c) => c.id === cardId);
                                if (c) {
                                    c.error = event.content || '生成失败';
                                }
                            });
                            break;
                        }
                    }
                } catch (err: unknown) {
                    if ((err as Error).name !== 'AbortError') {
                        set((state) => {
                            const c = state.cards.find((c) => c.id === cardId);
                            if (c) {
                                c.error = (err as Error).message;
                            }
                        });
                    }
                } finally {
                    abortControllers.delete(cardId);
                    set((state) => {
                        const c = state.cards.find((c) => c.id === cardId);
                        if (c) c.isStreaming = false;
                    });
                }
            },

            stopStreaming: (cardId) => {
                const ctrl = abortControllers.get(cardId);
                if (ctrl) ctrl.abort();
            },
        })),
        {
            name: 'rc-ai-cards',
            partialize: (state) => ({
                viewMode: state.viewMode,
                cards: state.cards.map((c) => ({
                    ...c,
                    isStreaming: false,
                })),
                selectedCardId: state.selectedCardId,
                customTemplates: state.customTemplates,
                skills: state.skills,
                customFormats: state.customFormats,
            }),
        }
    )
);

/** Extract text content from a node's data for use as AI context */
function extractNodeContent(data: { type: string; title: string; content?: string; columns?: Array<{ name: string }>; rows?: Array<{ cells: Record<string, unknown> }> }): string {
    if (data.type === 'table' && data.columns && data.rows) {
        const headers = data.columns.map((c) => c.name).join(' | ');
        const rows = data.rows.map((r) =>
            data.columns!.map((c) => {
                const v = r.cells[c.name] ?? r.cells[Object.keys(r.cells)[data.columns!.indexOf(c)]] ?? '';
                return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
            }).join(' | ')
        ).join('\n');
        return `${headers}\n${rows}`;
    }
    if (data.content) {
        return data.content.replace(/<[^>]*>/g, '').trim();
    }
    return '';
}
