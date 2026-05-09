import { create } from 'zustand';
import {
    AUTH_STORAGE_KEY,
    clearStoredAuthSession,
    decodeSessionJwtPayload,
    getValidStoredSessionToken,
    isExpiredSessionJwt,
} from '../utils/sessionAuth.ts';

interface User {
    googleId: string;
    actorGoogleId?: string;
    email: string;
    name: string;
    picture: string;
    role?: 'editor' | 'viewer';
    readOnly?: boolean;
}

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    loginError: string | null;
    login: (googleCredential: string, mode?: 'default' | 'viewer') => Promise<void>;
    switchMode: (mode: 'default' | 'viewer') => Promise<void>;
    logout: () => void;
    checkAuth: () => void;
}

const STORAGE_KEY = AUTH_STORAGE_KEY;
const LOCAL_RETURN_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function getLocalReturnToUrl(token: string): string | null {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get('returnTo');
    if (!returnTo) return null;

    try {
        const url = new URL(returnTo);
        if (!LOCAL_RETURN_HOSTS.has(url.hostname)) return null;
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        url.searchParams.set('token', token);
        return url.toString();
    } catch {
        return null;
    }
}

function redirectToLocalReturnTo(token: string): boolean {
    const returnToUrl = getLocalReturnToUrl(token);
    if (!returnToUrl) return false;
    window.location.href = returnToUrl;
    return true;
}

function persistSessionToken(token: string): User {
    const payload = decodeSessionJwtPayload(token);
    if (!payload) {
        throw new Error('Invalid session token');
    }
    const user: User = {
        googleId: payload.sub as string,
        actorGoogleId: (payload.actorSub as string) || (payload.sub as string),
        email: payload.email as string,
        name: payload.name as string,
        picture: (payload.picture as string) || '',
        role: (payload.role as User['role']) || 'editor',
        readOnly: payload.readOnly === true || payload.role === 'viewer',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...user, _credential: token }));
    return user;
}

export const useAuthStore = create<AuthState>()((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    loginError: null,

    login: async (googleCredential: string, mode: 'default' | 'viewer' = 'default') => {
        set({ loginError: null });
        try {
            // Exchange Google credential for our own 7-day session token
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: googleCredential, mode }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Login failed' }));
                const errorMsg = body.error || 'Login failed';
                set({ isLoading: false, loginError: errorMsg });
                return;
            }
            const { token } = await res.json();

            const user = persistSessionToken(token);
            set({ user, isAuthenticated: true, isLoading: false, loginError: null });
            redirectToLocalReturnTo(token);
        } catch (err) {
            console.error('Login failed:', err);
            set({ isLoading: false, loginError: (err as Error).message });
        }
    },

    switchMode: async (mode: 'default' | 'viewer') => {
        set({ loginError: null });
        try {
            const token = getValidStoredSessionToken({
                allowSessionToken: true,
                allowDevToken: import.meta.env.DEV,
                cleanupInvalid: true,
                normalizeSessionToken: true,
            });
            if (!token) throw new Error('Not authenticated');
            const res = await fetch('/api/auth/switch-mode', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ mode }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Switch mode failed' }));
                throw new Error(body.error || 'Switch mode failed');
            }
            const { token: nextToken } = await res.json();
            const user = persistSessionToken(nextToken);
            set({ user, isAuthenticated: true, isLoading: false, loginError: null });
            window.location.reload();
        } catch (err) {
            console.error('Switch mode failed:', err);
            set({ loginError: (err as Error).message });
            throw err;
        }
    },

    logout: () => {
        clearStoredAuthSession(true);
        set({ user: null, isAuthenticated: false });
        if (window.google?.accounts?.id) {
            window.google.accounts.id.disableAutoSelect();
        }
    },

    checkAuth: () => {
        try {
            if (window.location.pathname === '/auth/callback') {
                const params = new URLSearchParams(window.location.search);
                const token = params.get('token');
                const error = params.get('error');

                if (error) {
                    window.history.replaceState(null, '', '/login');
                    set({ user: null, isAuthenticated: false, isLoading: false, loginError: error });
                    return;
                }

                if (token) {
                    const user = persistSessionToken(token);
                    window.history.replaceState(null, '', '/');
                    set({ user, isAuthenticated: true, isLoading: false, loginError: null });
                    return;
                }
            }

            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                const token = getValidStoredSessionToken({
                    allowSessionToken: true,
                    allowDevToken: import.meta.env.DEV,
                    cleanupInvalid: true,
                    normalizeSessionToken: true,
                });
                if (!token) {
                    set({ isLoading: false });
                    return;
                }
                // Allow dev-token bypass without JWT validation
                if (token !== 'dev-token') {
                    // Check if session token has expired
                    if (isExpiredSessionJwt(token)) {
                        console.warn('Session token expired, clearing session');
                        clearStoredAuthSession(true);
                        set({ isLoading: false });
                        return;
                    }
                }
                const payload = token === 'dev-token' ? null : decodeSessionJwtPayload(token);
                const user: User = {
                    googleId: (payload?.sub as string) || parsed.googleId,
                    actorGoogleId: (payload?.actorSub as string) || parsed.actorGoogleId || parsed.googleId,
                    email: (payload?.email as string) || parsed.email,
                    name: (payload?.name as string) || parsed.name,
                    picture: (payload?.picture as string) || parsed.picture || '',
                    role: ((payload?.role as User['role']) || parsed.role || 'editor') as User['role'],
                    readOnly: payload?.readOnly === true || payload?.role === 'viewer' || parsed.readOnly === true || parsed.role === 'viewer',
                };
                if (redirectToLocalReturnTo(token)) return;
                set({ user, isAuthenticated: true, isLoading: false });
            } else {
                set({ isLoading: false });
        }
    } catch {
            clearStoredAuthSession(true);
            set({ isLoading: false });
        }
    },
}));
