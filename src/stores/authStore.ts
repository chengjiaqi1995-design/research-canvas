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
    email: string;
    name: string;
    picture: string;
}

interface AuthState {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    loginError: string | null;
    login: (googleCredential: string) => Promise<void>;
    logout: () => void;
    checkAuth: () => void;
}

const STORAGE_KEY = AUTH_STORAGE_KEY;

function persistSessionToken(token: string): User {
    const payload = decodeSessionJwtPayload(token);
    if (!payload) {
        throw new Error('Invalid session token');
    }
    const user: User = {
        googleId: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
        picture: (payload.picture as string) || '',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...user, _credential: token }));
    return user;
}

export const useAuthStore = create<AuthState>()((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    loginError: null,

    login: async (googleCredential: string) => {
        set({ loginError: null });
        try {
            // Exchange Google credential for our own 7-day session token
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: googleCredential }),
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
        } catch (err) {
            console.error('Login failed:', err);
            set({ isLoading: false, loginError: (err as Error).message });
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
                    email: (payload?.email as string) || parsed.email,
                    name: (payload?.name as string) || parsed.name,
                    picture: (payload?.picture as string) || parsed.picture || '',
                };
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
