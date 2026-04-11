// API client for Research Canvas backend
// Automatically attaches Google ID Token to all requests

const API_BASE = '/api';

function getToken(): string | null {
    try {
        const stored = localStorage.getItem('rc_auth_user');
        if (stored) {
            const parsed = JSON.parse(stored);
            return parsed._credential || null;
        }
    } catch {
        // ignore
    }
    return null;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();
    if (!token) {
        throw new Error('Not authenticated');
    }

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...options.headers,
        },
    });

    if (!res.ok) {
        // If token is expired/invalid, clear auth and redirect to login
        if (res.status === 401) {
            console.warn('API returned 401, clearing auth session');
            localStorage.removeItem('rc_auth_user');
            window.location.reload();
        }
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `API error ${res.status}`);
    }

    return res.json() as Promise<T>;
}

export const industryCategoryApi = {
    get: () => request<any>('/industry-categories'),
    save: (config: any) =>
        request<{ ok: boolean }>('/industry-categories', {
            method: 'PUT',
            body: JSON.stringify(config),
        }),
};

// ─── Industry Wiki API ──────────────────────────────────────
export const industryWikiApi = {
    get: () => request<any>('/industry-wiki'),
    save: (data: any) =>
        request<{ ok: boolean }>('/industry-wiki', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),
};

// ─── Wiki Generation History API ───────────────────────────
export const wikiGenerationLogApi = {
    list: (scope?: string, limit?: number) => {
        let qs = '';
        if (scope) qs += `?scope=${encodeURIComponent(scope)}`;
        if (limit) qs += `${qs ? '&' : '?'}limit=${limit}`;
        return request<any>(`/industry-wiki/generation-logs${qs}`);
    },
    get: (id: string) => request<any>(`/industry-wiki/generation-logs/${id}`),
    create: (data: any) =>
        request<any>('/industry-wiki/generation-logs', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: { label?: string; note?: string }) =>
        request<any>(`/industry-wiki/generation-logs/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),
    delete: (id: string) =>
        request<any>(`/industry-wiki/generation-logs/${id}`, { method: 'DELETE' }),
};

// ─── Workspace API ─────────────────────────────────────────
export const workspaceApi = {
    list: () => request<any[]>('/workspaces'),

    create: (workspace: any) =>
        request<any>('/workspaces', {
            method: 'POST',
            body: JSON.stringify(workspace),
        }),

    update: (id: string, updates: any) =>
        request<any>(`/workspaces/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }),

    delete: (id: string) =>
        request<any>(`/workspaces/${id}`, { method: 'DELETE' }),
};

// ─── Canvas API ────────────────────────────────────────────
export const canvasApi = {
    list: (workspaceId?: string, lite?: boolean) => {
        const params = new URLSearchParams();
        if (workspaceId) params.set('workspaceId', workspaceId);
        if (lite) params.set('lite', '1');
        const qs = params.toString();
        return request<any[]>(`/canvases${qs ? `?${qs}` : ''}`);
    },

    get: (id: string) => request<any>(`/canvases/${id}`),

    create: (canvas: any) =>
        request<any>('/canvases', {
            method: 'POST',
            body: JSON.stringify(canvas),
        }),

    update: (id: string, data: any) =>
        request<any>(`/canvases/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    delete: (id: string) =>
        request<any>(`/canvases/${id}`, { method: 'DELETE' }),

    moveNode: (nodeId: string, sourceCanvasId: string, targetCanvasId: string, updateCompany?: string) =>
        request<{ ok: boolean; targetCanvasId: string }>('/canvas/move-node', {
            method: 'POST',
            body: JSON.stringify({ nodeId, sourceCanvasId, targetCanvasId, updateCompany }),
        }),
};

// ─── Seed API ──────────────────────────────────────────────
export const seedApi = {
    seed: (data: { workspace: any; canvas: any }) =>
        request<{ seeded: boolean }>('/seed', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};

// ─── PDF API ───────────────────────────────────────────────
export const pdfApi = {
    convert: async (file: File): Promise<{ markdown: string; filename: string }> => {
        const token = getToken();
        if (!token) throw new Error('Not authenticated');

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_BASE}/convert-pdf`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(body.error || `API error ${res.status}`);
        }

        return res.json();
    },
};

export const fileApi = {
    upload: async (file: File): Promise<{ url: string; filename: string; originalName: string }> => {
        const token = getToken();
        if (!token) throw new Error('Not authenticated');

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${API_BASE}/upload-pdf`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(body.error || `API error ${res.status}`);
        }

        return res.json();
    },
};

// ─── Sync API (AI Notebook) ───────────────────────────────
export const syncApi = {
    fetchNotes: () =>
        request<any>('/sync/fetch-notes'),

    fetchNoteDetail: (noteId: string) =>
        request<any>(`/sync/fetch-note-detail/${noteId}`),

    classifyNotes: (notes: { id: string; company: string | null; industries: string[]; topic: string | null; fileName: string }[], industryFolders: string[]) =>
        request<{ success: boolean; classifications: { id: string; folder: string; ticker?: string }[] }>('/sync/classify', {
            method: 'POST',
            body: JSON.stringify({ notes, industryFolders }),
        }),

    batchImport: (canvases: any[]) =>
        request<{ success: boolean; imported: number }>('/sync/batch-import', {
            method: 'POST',
            body: JSON.stringify({ canvases }),
        }),

    reclassifyNotes: (dryRun: boolean = true) =>
        request<{ success: boolean; dryRun: boolean; moved: number; log: string[] }>('/migrate/reclassify-notes', {
            method: 'POST',
            body: JSON.stringify({ dryRun }),
        }),
};

// ─── AI Process → Canvas Sync API ────────────────────────
export const canvasSyncApi = {
    fetchUnsynced: () =>
        request<{ success: boolean; data: { items: any[]; total: number } }>('/transcriptions/unsynced-for-canvas'),

    classify: (transcriptionIds: string[]) =>
        request<{ success: boolean; classifications: { id: string; fileName: string; organization: string; folder: string; canvasName: string; ticker: string; isNewWorkspace: boolean; isNewCanvas: boolean }[] }>('/canvas-sync/classify', {
            method: 'POST',
            body: JSON.stringify({ transcriptionIds }),
        }),

    execute: (items: { transcriptionId: string; folder: string; canvasName: string; ticker: string }[]) =>
        request<{ success: boolean; synced: number; skipped: number; results: { id: string; fileName: string; folder: string; canvas: string; status: string }[] }>('/canvas-sync/execute', {
            method: 'POST',
            body: JSON.stringify({ items }),
        }),

    getTranscriptionContent: (transcriptionId: string) =>
        request<{ success: boolean; content: string; title: string; transcriptionId: string; tags: string[]; metadata: Record<string, string> }>(`/canvas-sync/transcription-content/${transcriptionId}`),

    updateTranscriptionContent: (transcriptionId: string, content: string) =>
        request<{ success: boolean }>(`/canvas-sync/transcription-content/${transcriptionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ content }),
        }),

    updateTranscriptionTitle: (transcriptionId: string, title: string) =>
        request<{ success: boolean }>(`/canvas-sync/transcription-title/${transcriptionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ title }),
        }),

    updateTranscriptionMetadata: (transcriptionId: string, metadata: {
        topic?: string; organization?: string; intermediary?: string;
        industry?: string; country?: string; participants?: string;
        eventDate?: string; speaker?: string;
    }) =>
        request<{ success: boolean }>(`/canvas-sync/transcription-metadata/${transcriptionId}`, {
            method: 'PATCH',
            body: JSON.stringify(metadata),
        }),
};

// ─── Notes Query API ─────────────────────────────────────
export const notesApi = {
    query: (workspaceIds: string[], canvasIds?: string[], dateFrom?: string, dateTo?: string, dateField?: 'occurred' | 'created') =>
        request<{ success: boolean; notes: { id: string; canvasId: string; title: string; content: string; workspaceId: string; workspaceName: string; date: string | null; metadata?: Record<string, string> }[]; total: number }>('/notes/query', {
            method: 'POST',
            body: JSON.stringify({ workspaceIds, canvasIds, dateFrom, dateTo, dateField }),
        }),
};

// ─── AI API ────────────────────────────────────────────────
export const aiApi = {
    getModels: () => request<{ id: string; name: string; provider: string }[]>('/ai/models'),

    getSettings: () => request<{ keys: Record<string, string>; defaultModel: string; summaryPrompt?: string; excelParsingModel?: string; excelParsingPrompt?: string; skills?: import('../types/index.ts').AISkill[]; customTemplates?: import('../types/index.ts').PromptTemplate[]; customFormats?: import('../types/index.ts').FormatTemplate[] }>('/ai/settings'),

    saveSettings: (data: { keys?: Record<string, string>; defaultModel?: string; summaryPrompt?: string; excelParsingModel?: string; excelParsingPrompt?: string; skills?: import('../types/index.ts').AISkill[]; customTemplates?: import('../types/index.ts').PromptTemplate[]; customFormats?: import('../types/index.ts').FormatTemplate[] }) =>
        request<{ ok: boolean }>('/ai/settings', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    /** Stream AI chat response. Returns an async iterator of SSE events. */
    chatStream: async function* (payload: {
        model: string;
        messages: { role: string; content: string }[];
        systemPrompt?: string;
        tools?: Array<Record<string, unknown>>;
        signal?: AbortSignal;
    }): AsyncGenerator<{ type: string; content?: string; usage?: Record<string, number> }> {
        const token = getToken();
        if (!token) throw new Error('Not authenticated');

        const { signal, ...bodyPayload } = payload;
        const res = await fetch(`${API_BASE}/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(bodyPayload),
            signal,
        });

        if (!res.ok) {
            let errorMsg = `API error ${res.status}`;
            try {
                const body = await res.json();
                errorMsg = body.error || errorMsg;
            } catch {
                try {
                    errorMsg = await res.text() || errorMsg;
                } catch { /* use default */ }
            }
            throw new Error(errorMsg);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        yield JSON.parse(line.slice(6));
                    } catch { /* skip malformed */ }
                }
            }
        }
    },
};

// ─── Admin / Monitor API ────────────────────────────────────────────────
export const adminApi = {
    getAllUsers: () => request<{ success: boolean; data: { users: { id: string; email: string; name: string; picture: string | null; createdAt: string; updatedAt: string }[] } }>('/user/all'),
};

// ─── Share Monitor API ──────────────────────────────────────────────────
export const shareMonitorApi = {
    getMyShares: () => request<{ success: boolean; data: { id: string; title: string; shareToken: string; viewCount: number; expiresAt: string | null; createdAt: string; shareUrl: string }[] }>('/share/my/list'),
    getAccessLogs: (token: string, page = 1, pageSize = 50) => request<{ 
        success: boolean; 
        data: { 
            items: { id: string; userId: string | null; userEmail: string | null; userName: string | null; ipAddress: string; userAgent: string; accessedAt: string; accessCount: number }[];
            total: number;
            page: number;
            pageSize: number;
            uniqueVisitors: number;
        }
    }>(`/share/${token}/access-logs?page=${page}&pageSize=${pageSize}`),
    revokeShare: (id: string) => request<{ success: boolean }>(`/share/${id}`, { method: 'DELETE' }),
};

// ─── Tracker API ──────────────────────────────────────────────────
import type { Tracker, TrackerInboxItem } from '../types/index.ts';

export const trackerApi = {
    getTrackers: () => request<Tracker[]>('/trackers'),
    saveTrackers: (trackers: Tracker[]) =>
        request<{ success: boolean }>('/trackers', {
            method: 'POST',
            body: JSON.stringify({ trackers }),
        }),
    deleteTracker: (id: string) =>
        request<{ success: boolean }>(`/trackers/${id}`, { method: 'DELETE' }),

    getInbox: () => request<TrackerInboxItem[]>('/trackers/inbox'),
    addInbox: (item: TrackerInboxItem) =>
        request<{ success: boolean; item: TrackerInboxItem }>('/trackers/inbox', {
            method: 'POST',
            body: JSON.stringify(item),
        }),
    deleteInbox: (id: string) =>
        request<{ success: boolean }>(`/trackers/inbox/${id}`, { method: 'DELETE' }),
};

// ─── Feed API (OpenClaw 信息流) ─────────────────────────────────────
export interface FeedItem {
    id: string;
    type: string;
    category: string;
    title: string;
    content: string;
    source: string;
    publishedAt: string;
    pushedAt: string;
    isRead: boolean;
    isStarred: boolean;
    tags: string[];
    createdAt: string;
    updatedAt: string;
}

export const feedApi = {
    list: (params?: { type?: string; isRead?: string; isStarred?: string; category?: string; page?: number; pageSize?: number }) => {
        const qs = new URLSearchParams();
        if (params?.type) qs.set('type', params.type);
        if (params?.isRead !== undefined) qs.set('isRead', params.isRead);
        if (params?.isStarred !== undefined) qs.set('isStarred', params.isStarred);
        if (params?.category) qs.set('category', params.category);
        if (params?.page) qs.set('page', String(params.page));
        if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
        const q = qs.toString();
        return request<{ success: boolean; data: FeedItem[]; total: number }>(`/feed${q ? `?${q}` : ''}`);
    },
    update: (id: string, updates: Partial<Pick<FeedItem, 'isRead' | 'isStarred'>>) =>
        request<{ success: boolean; data: FeedItem }>(`/feed/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
    remove: (id: string) =>
        request<{ success: boolean }>(`/feed/${id}`, { method: 'DELETE' }),
    markAllRead: (type?: string) =>
        request<{ success: boolean; count: number }>('/feed/mark-all-read', { method: 'POST', body: JSON.stringify({ type }) }),
};
