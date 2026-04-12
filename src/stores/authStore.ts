import { create } from 'zustand';

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

function decodeJwtPayload(token: string): Record<string, unknown> {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
        atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
    );
    return JSON.parse(jsonPayload);
}

const STORAGE_KEY = 'rc_auth_user';

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

            // Decode our session token to extract user info
            const payload = decodeJwtPayload(token);
            const user: User = {
                googleId: payload.sub as string,
                email: payload.email as string,
                name: payload.name as string,
                picture: payload.picture as string,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...user, _credential: token }));
            set({ user, isAuthenticated: true, isLoading: false, loginError: null });
        } catch (err) {
            console.error('Login failed:', err);
            set({ isLoading: false, loginError: (err as Error).message });
        }
    },

    logout: () => {
        localStorage.removeItem(STORAGE_KEY);
        set({ user: null, isAuthenticated: false });
        if (window.google?.accounts?.id) {
            window.google.accounts.id.disableAutoSelect();
        }
    },

    checkAuth: () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (!parsed._credential) {
                    localStorage.removeItem(STORAGE_KEY);
                    set({ isLoading: false });
                    return;
                }
                // Allow dev-token bypass without JWT validation
                if (parsed._credential !== 'dev-token') {
                    // Check if session token has expired
                    try {
                        const payload = decodeJwtPayload(parsed._credential);
                        const exp = (payload.exp as number) * 1000;
                        if (Date.now() >= exp) {
                            console.warn('Session token expired, clearing session');
                            localStorage.removeItem(STORAGE_KEY);
                            set({ isLoading: false });
                            return;
                        }
                    } catch {
                        localStorage.removeItem(STORAGE_KEY);
                        set({ isLoading: false });
                        return;
                    }
                }
                const user: User = {
                    googleId: parsed.googleId,
                    email: parsed.email,
                    name: parsed.name,
                    picture: parsed.picture,
                };
                set({ user, isAuthenticated: true, isLoading: false });
            } else {
                set({ isLoading: false });
            }
        } catch {
            localStorage.removeItem(STORAGE_KEY);
            set({ isLoading: false });
        }
    },
}));
