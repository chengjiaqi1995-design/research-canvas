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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `API error ${res.status}`);
    }

    return res.json() as Promise<T>;
}

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
    list: (workspaceId: string) =>
        request<any[]>(`/canvases?workspaceId=${workspaceId}`),

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
};

// ─── Seed API ──────────────────────────────────────────────
export const seedApi = {
    seed: (data: { workspace: any; canvas: any }) =>
        request<{ seeded: boolean }>('/seed', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};
