import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';
import { aiApi, aiCardsApi } from '../db/apiClient.ts';
import { generateId } from '../utils/id.ts';
import type { AIModel, AICardNodeData, PromptTemplate, AISkill, FormatTemplate } from '../types/index.ts';
import { logCardEvent, detectVanishedCards } from './aiCardLogger.ts';

// Keep abort controllers outside immer (Map is not natively supported by immer)
const abortControllers = new Map<string, AbortController>();

// Cloud sync status — exposed via store state
type CloudSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
let _cloudSyncStatus: CloudSyncStatus = 'idle';
let _cloudSyncStatusListeners: Array<(s: CloudSyncStatus) => void> = [];
function _setCloudSyncStatus(s: CloudSyncStatus) {
    _cloudSyncStatus = s;
    _cloudSyncStatusListeners.forEach(fn => fn(s));
}

// Debounced cloud push for cards with retry (exponential backoff, max 5 attempts by default)
let _cardsPushTimer: ReturnType<typeof setTimeout> | null = null;
let _streamingPushInterval: ReturnType<typeof setInterval> | null = null;
let _lastPushedSnapshot = '';

async function _pushCardsWithRetry(cards: any[], attempt = 0, maxRetries = 5): Promise<void> {
    const cleanCards = cards.map((c: any) => ({ ...c, isStreaming: false }));
    const snapshot = JSON.stringify(cleanCards);
    // 跳过重复推送：和上次成功推上去的一模一样就不重推
    if (snapshot === _lastPushedSnapshot) {
        _setCloudSyncStatus('synced');
        logCardEvent('push_skipped_unchanged', {
            summary: `跳过重复推送（${cleanCards.length} 张卡片，快照未变）`,
            detail: { count: cleanCards.length, snapshotSize: snapshot.length },
        });
        return;
    }
    try {
        _setCloudSyncStatus('syncing');
        if (attempt === 0) {
            logCardEvent('push_start', {
                summary: `开始推送 ${cleanCards.length} 张卡片到云端`,
                detail: {
                    count: cleanCards.length,
                    snapshotSize: snapshot.length,
                    cardIds: cleanCards.map((c: any) => c.id),
                },
            });
        }
        await aiCardsApi.save(cleanCards);
        _lastPushedSnapshot = snapshot;
        _setCloudSyncStatus('synced');
        logCardEvent('push_success', {
            summary: `推送成功（${cleanCards.length} 张，第 ${attempt + 1} 次尝试）`,
            detail: { count: cleanCards.length, attempt: attempt + 1 },
        });
        setTimeout(() => {
            if (_cloudSyncStatus === 'synced') _setCloudSyncStatus('idle');
        }, 3000);
    } catch (e: unknown) {
        const errMsg = (e as any)?.message || String(e);
        console.error(`Failed to push AI cards to cloud (attempt ${attempt + 1}/${maxRetries}):`, e);
        logCardEvent('push_failure', {
            summary: `推送失败（第 ${attempt + 1}/${maxRetries} 次）: ${errMsg}`,
            detail: { attempt: attempt + 1, maxRetries, error: errMsg, count: cleanCards.length },
        });
        if (attempt < maxRetries - 1) {
            const delay = Math.min(Math.pow(2, attempt) * 1000, 30000);
            await new Promise(resolve => setTimeout(resolve, delay));
            return _pushCardsWithRetry(cards, attempt + 1, maxRetries);
        }
        _setCloudSyncStatus('error');
    }
}

function debouncedPushCards(cards: any[]) {
    if (_cardsPushTimer) clearTimeout(_cardsPushTimer);
    _cardsPushTimer = setTimeout(() => {
        _pushCardsWithRetry(cards);
    }, 2000);
}

/** 立即推送（不走 2s 防抖）— 用于流式生成结束、卡片删除等关键时刻 */
function immediatePushCards(cards: any[]) {
    if (_cardsPushTimer) { clearTimeout(_cardsPushTimer); _cardsPushTimer = null; }
    _pushCardsWithRetry(cards);
}

/** 开启流式期间的定期推送（每 10s 一次，保证长文本也不丢） */
function startStreamingPushInterval(getCards: () => any[]) {
    if (_streamingPushInterval) return;
    _streamingPushInterval = setInterval(() => {
        _pushCardsWithRetry(getCards());
    }, 10000);
}
function stopStreamingPushInterval() {
    if (_streamingPushInterval) {
        clearInterval(_streamingPushInterval);
        _streamingPushInterval = null;
    }
}

/** 关闭/隐藏页面时用 sendBeacon 发一次，防止关页面丢内容 */
if (typeof window !== 'undefined') {
    const flushOnHide = () => {
        try {
            const state = (window as any).__aiCardStore?.getState?.();
            if (!state || !state.cards || state.cards.length === 0) return;
            const cleanCards = state.cards.map((c: any) => ({ ...c, isStreaming: false }));
            const snapshot = JSON.stringify(cleanCards);
            if (snapshot === _lastPushedSnapshot) return;
            const blob = new Blob([JSON.stringify({ cards: cleanCards })], { type: 'application/json' });
            // 注意：sendBeacon 不能带 Authorization header —— 后端需要用 cookie 认证或放行匿名写（视实现而定）
            // 即便 sendBeacon 失败，立即尝试 fetch 作为备份
            navigator.sendBeacon?.('/api/ai/cards', blob);
            // 同时触发一次 immediate push（能否完成取决于浏览器是否 kill）
            immediatePushCards(state.cards);
        } catch { /* 忽略，尽力而为 */ }
    };
    window.addEventListener('pagehide', flushOnHide);
    window.addEventListener('beforeunload', flushOnHide);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushOnHide();
    });
}

// Custom IndexedDB storage adapter with LocalStorage migration
const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const val = await get(name);
      if (val !== undefined && val !== null) {
        return val as string;
      }
      // Migrate from localStorage
      const oldVal = localStorage.getItem(name);
      if (oldVal !== null) {
        await set(name, oldVal);
        localStorage.removeItem(name);
        return oldVal;
      }
      return null;
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await set(name, value);
    } catch (e) {
      console.warn('aiCardStore idb setItem failed', e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await del(name);
    } catch {}
  },
};

export interface AICard extends AICardNodeData {
    id: string;
}

interface AICardStoreState {
    // View mode
    viewMode: 'canvas' | 'ai_research' | 'ai_process' | 'portfolio' | 'tracker' | 'feed';
    setViewMode: (mode: 'canvas' | 'ai_research' | 'ai_process' | 'portfolio' | 'tracker' | 'feed') => void;

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
    syncCardsFromCloud: () => Promise<void>;
    pushCardsToCloud: () => void;

    // Cloud sync status
    cloudSyncStatus: CloudSyncStatus;

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
            cloudSyncStatus: 'idle' as CloudSyncStatus,

            setViewMode: (mode) => {
                set((state) => {
                    state.viewMode = mode;
                });
            },

            addCard: (initial) => {
                const id = generateId();
                const title = initial?.title || 'AI 卡片';
                set((state) => {
                    state.cards.push({
                        id,
                        type: 'ai_card',
                        title,
                        prompt: initial?.prompt || '',
                        config: {
                            model: state.models[0]?.id || 'gemini-3-flash-preview',
                            sourceMode: 'notes',
                            sourceNodeIds: [],
                            outputFormat: 'markdown',
                            formatId: undefined,
                        },
                        generatedContent: '',
                        editedContent: '',
                        isStreaming: false,
                        updatedAt: Date.now(),
                    });
                    state.selectedCardId = id;
                });
                logCardEvent('card_create', {
                    cardId: id,
                    cardTitle: title,
                    summary: `创建卡片 "${title}"`,
                    detail: { totalCards: get().cards.length, initial },
                });
                immediatePushCards(get().cards);
            },

            removeCard: (id) => {
                const cardBefore = get().cards.find(c => c.id === id);
                const ctrl = abortControllers.get(id);
                if (ctrl) ctrl.abort();
                abortControllers.delete(id);
                set((state) => {
                    state.cards = state.cards.filter((c) => c.id !== id);
                    if (state.selectedCardId === id) {
                        state.selectedCardId = state.cards.length > 0 ? state.cards[0].id : null;
                    }
                });
                logCardEvent('card_remove', {
                    cardId: id,
                    cardTitle: cardBefore?.title,
                    summary: `删除卡片 "${cardBefore?.title || id}"`,
                    detail: {
                        hadContent: !!(cardBefore?.generatedContent && cardBefore.generatedContent.length > 0),
                        contentLen: (cardBefore?.generatedContent || '').length,
                        remainingCards: get().cards.length,
                    },
                });
                immediatePushCards(get().cards);
            },

            updateCard: (id, updates) => {
                const before = get().cards.find(c => c.id === id);
                set((state) => {
                    const card = state.cards.find((c) => c.id === id);
                    if (card) {
                        Object.assign(card, updates);
                        card.updatedAt = Date.now();
                    }
                });
                const changedKeys = Object.keys(updates);
                logCardEvent('card_update', {
                    cardId: id,
                    cardTitle: before?.title,
                    summary: `更新卡片 "${before?.title || id}"（${changedKeys.join(', ')}）`,
                    detail: { changedKeys },
                });
                get().pushCardsToCloud();
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
                        card.updatedAt = Date.now();
                    }
                });
                // 节流：chunk 日志每秒最多一条（内部已做）
                const card = get().cards.find(c => c.id === cardId);
                logCardEvent('generate_chunk', {
                    cardId,
                    cardTitle: card?.title,
                    summary: `流式追加（当前 ${(card?.generatedContent || '').length} 字符）`,
                    detail: { chunkLen: chunk.length, totalLen: (card?.generatedContent || '').length },
                });
                startStreamingPushInterval(() => get().cards);
            },

            setCardStreaming: (cardId, streaming) => {
                const before = get().cards.find(c => c.id === cardId);
                set((state) => {
                    const card = state.cards.find((c) => c.id === cardId);
                    if (card) {
                        card.isStreaming = streaming;
                        card.updatedAt = Date.now();
                        if (!streaming) {
                            card.lastGeneratedAt = Date.now();
                        }
                    }
                });
                if (streaming) {
                    logCardEvent('generate_start', {
                        cardId,
                        cardTitle: before?.title,
                        summary: `开始生成 "${before?.title || cardId}"`,
                        detail: { model: before?.config?.model, promptLen: (before?.prompt || '').length },
                    });
                } else {
                    const after = get().cards.find(c => c.id === cardId);
                    logCardEvent('generate_end', {
                        cardId,
                        cardTitle: after?.title,
                        summary: `生成完成（总长 ${(after?.generatedContent || '').length} 字符）`,
                        detail: { totalLen: (after?.generatedContent || '').length },
                    });
                    stopStreamingPushInterval();
                    immediatePushCards(get().cards);
                }
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

                        if (serverSkills.length > 0) {
                            state.skills = serverSkills;
                        }
                        if (serverTemplates.length > 0) {
                            state.customTemplates = serverTemplates;
                        }
                        if (serverFormats.length > 0) {
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

                // Also sync AI cards from cloud
                try {
                    await get().syncCardsFromCloud();
                } catch (e) {
                    console.error('Failed to sync AI cards from cloud:', e);
                }
            },

            pushToServer: () => {
                const { skills, customTemplates, customFormats } = get();
                aiApi.saveSettings({ skills, customTemplates, customFormats }).catch(e => {
                    console.error('Failed to push templates/skills/formats to server:', e);
                });
            },

            syncCardsFromCloud: async () => {
                const localBefore = get().cards.map(c => ({ id: c.id, title: c.title }));
                logCardEvent('sync_start', {
                    summary: `开始同步云端（本地当前 ${localBefore.length} 张）`,
                    detail: { localCount: localBefore.length, localIds: localBefore.map(c => c.id) },
                });
                try {
                    const { cards: cloudCards } = await aiCardsApi.get();
                    if (!cloudCards || cloudCards.length === 0) {
                        const localCards = get().cards;
                        if (localCards.length > 0) {
                            debouncedPushCards(localCards);
                            logCardEvent('sync_cloud_empty_pushed_local', {
                                summary: `云端为空，推送本地 ${localCards.length} 张上去`,
                                detail: { count: localCards.length, cardIds: localCards.map(c => c.id) },
                            });
                            console.log(`☁️ Cloud empty, pushing ${localCards.length} local AI cards up`);
                        } else {
                            logCardEvent('sync_merge_result', {
                                summary: '云端和本地都为空，无事发生',
                                detail: { cloudCount: 0, localCount: 0 },
                            });
                        }
                        return;
                    }

                    const localCards = get().cards;
                    const cloudMap = new Map<string, any>(cloudCards.map((c: any) => [c.id, c]));
                    const localIds = new Set(localCards.map(c => c.id));
                    let preservedLocal = 0;
                    const decisions: Array<{ id: string; winner: 'local' | 'cloud'; reason: string }> = [];

                    const mergedFromLocal = localCards.map(local => {
                        const cloud = cloudMap.get(local.id);
                        if (!cloud) {
                            decisions.push({ id: local.id, winner: 'local', reason: 'cloud 没有此卡片' });
                            return local;
                        }
                        if (local.isStreaming) {
                            preservedLocal++;
                            decisions.push({ id: local.id, winner: 'local', reason: '本地正在流式生成' });
                            return local;
                        }
                        const localUpdatedAt = (local as any).updatedAt || local.lastGeneratedAt || 0;
                        const cloudUpdatedAt = (cloud as any).updatedAt || cloud.lastGeneratedAt || 0;
                        if (localUpdatedAt >= cloudUpdatedAt) {
                            preservedLocal++;
                            decisions.push({
                                id: local.id,
                                winner: 'local',
                                reason: `本地 updatedAt(${localUpdatedAt}) >= 云端 updatedAt(${cloudUpdatedAt})`,
                            });
                            return local;
                        }
                        decisions.push({
                            id: local.id,
                            winner: 'cloud',
                            reason: `云端 updatedAt(${cloudUpdatedAt}) 比本地 updatedAt(${localUpdatedAt}) 新`,
                        });
                        return cloud;
                    });

                    const cloudOnly = cloudCards.filter((c: any) => !localIds.has(c.id));
                    const merged = [...mergedFromLocal, ...cloudOnly];

                    set((state) => {
                        state.cards = merged;
                        if (state.selectedCardId && !merged.find((c: any) => c.id === state.selectedCardId)) {
                            state.selectedCardId = merged.length > 0 ? merged[0].id : null;
                        }
                    });

                    // 检测"消失的卡片"：merge 之后某 id 不再存在
                    const mergedIds = new Set(merged.map((c: any) => c.id));
                    const vanished = localBefore.filter(c => !mergedIds.has(c.id));

                    logCardEvent('sync_merge_result', {
                        summary: `同步完成（本地 ${localBefore.length} → 合并后 ${merged.length}）`,
                        detail: {
                            cloudCount: cloudCards.length,
                            localCountBefore: localBefore.length,
                            mergedCount: merged.length,
                            preservedLocal,
                            cloudOnlyCount: cloudOnly.length,
                            vanishedCount: vanished.length,
                            decisions,
                        },
                    });

                    if (vanished.length > 0) {
                        vanished.forEach(v => {
                            logCardEvent('card_vanish_detected', {
                                cardId: v.id,
                                cardTitle: v.title,
                                summary: `⚠️ 卡片在 sync 中从 state 中消失！id=${v.id}`,
                                detail: { context: 'syncCardsFromCloud' },
                            });
                        });
                    }

                    if (preservedLocal > 0 || cloudOnly.length < cloudCards.length) {
                        debouncedPushCards(merged);
                    }
                    console.log(`☁️ Synced AI cards: ${cloudOnly.length} new from cloud, ${preservedLocal} preserved local`);
                } catch (e) {
                    const errMsg = (e as any)?.message || String(e);
                    logCardEvent('sync_error', {
                        summary: `同步失败：${errMsg}`,
                        detail: { error: errMsg },
                    });
                    console.error('Failed to sync AI cards from cloud:', e);
                }
            },

            pushCardsToCloud: () => {
                debouncedPushCards(get().cards);
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
                        cardId,
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
                            const errMsg = event.content || '生成失败';
                            set((state) => {
                                const c = state.cards.find((c) => c.id === cardId);
                                if (c) c.error = errMsg;
                            });
                            logCardEvent('generate_error', {
                                cardId,
                                cardTitle: card.title,
                                summary: `生成失败：${errMsg}`,
                                detail: { error: errMsg },
                            });
                            break;
                        }
                    }
                } catch (err: unknown) {
                    const errMsg = (err as Error).message;
                    if ((err as Error).name !== 'AbortError') {
                        set((state) => {
                            const c = state.cards.find((c) => c.id === cardId);
                            if (c) c.error = errMsg;
                        });
                        logCardEvent('generate_error', {
                            cardId,
                            cardTitle: card.title,
                            summary: `生成异常：${errMsg}`,
                            detail: { error: errMsg, name: (err as Error).name },
                        });
                    }
                } finally {
                    abortControllers.delete(cardId);
                    // 最终保险：流式异常结束也要推送，避免丢内容
                    const finalCard = get().cards.find(c => c.id === cardId);
                    const hadContent = finalCard && (finalCard.generatedContent || '').length > 0;
                    set((state) => {
                        const c = state.cards.find((c) => c.id === cardId);
                        if (c) c.isStreaming = false;
                    });
                    stopStreamingPushInterval();
                    if (hadContent) {
                        immediatePushCards(get().cards);
                    }
                }
            },

            stopStreaming: (cardId) => {
                const ctrl = abortControllers.get(cardId);
                if (ctrl) ctrl.abort();
                const card = get().cards.find(c => c.id === cardId);
                logCardEvent('generate_abort', {
                    cardId,
                    cardTitle: card?.title,
                    summary: `用户中止生成（已累积 ${(card?.generatedContent || '').length} 字符）`,
                    detail: { accumulatedLen: (card?.generatedContent || '').length },
                });
            },
        })),
        {
            name: 'rc-ai-cards',
            storage: createJSONStorage(() => idbStorage),
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
            onRehydrateStorage: () => (state) => {
                // IndexedDB 数据加载完成（hydrate）
                if (state) {
                    logCardEvent('hydrate_from_idb', {
                        summary: `从 IndexedDB 恢复 ${state.cards?.length || 0} 张卡片`,
                        detail: {
                            cardCount: state.cards?.length || 0,
                            cardIds: state.cards?.map((c: any) => c.id) || [],
                        },
                    });
                }
            },
        }
    )
);

// 暴露 store 到全局，供 pagehide/beforeunload handler 在模块外部访问
if (typeof window !== 'undefined') {
    (window as any).__aiCardStore = useAICardStore;
}

// Wire up cloud sync status listener to update zustand state
_cloudSyncStatusListeners.push((status) => {
    useAICardStore.setState({ cloudSyncStatus: status });
});

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
