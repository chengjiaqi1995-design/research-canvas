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

// ─── Industry Categories API ──────────────────────────────
export const industryCategoryApi = {
    get: () => request<any>('/industry-categories'),
    save: (config: any) =>
        request<{ ok: boolean }>('/industry-categories', {
            method: 'PUT',
            body: JSON.stringify(config),
        }),
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
};

// ─── Notes Query API ─────────────────────────────────────
export const notesApi = {
    query: (workspaceIds: string[], canvasIds?: string[], dateFrom?: string, dateTo?: string, dateField?: 'occurred' | 'created') =>
        request<{ success: boolean; notes: { id: string; canvasId: string; title: string; content: string; workspaceId: string; workspaceName: string; date: string | null }[]; total: number }>('/notes/query', {
            method: 'POST',
            body: JSON.stringify({ workspaceIds, canvasIds, dateFrom, dateTo, dateField }),
        }),
};

// ─── AI API ────────────────────────────────────────────────
export const aiApi = {
    getModels: () => request<{ id: string; name: string; provider: string }[]>('/ai/models'),

    getSettings: () => request<{ keys: Record<string, string>; defaultModel: string; summaryPrompt?: string }>('/ai/settings'),

    saveSettings: (data: { keys?: Record<string, string>; defaultModel?: string; summaryPrompt?: string }) =>
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
    }): AsyncGenerator<{ type: string; content?: string; usage?: Record<string, number> }> {
        const token = getToken();
        if (!token) throw new Error('Not authenticated');

        const res = await fetch(`${API_BASE}/ai/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
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
