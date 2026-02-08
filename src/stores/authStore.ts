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
    login: (credential: string) => void;
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

    login: (credential: string) => {
        try {
            const payload = decodeJwtPayload(credential);
            const user: User = {
                googleId: payload.sub as string,
                email: payload.email as string,
                name: payload.name as string,
                picture: payload.picture as string,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...user, _credential: credential }));
            set({ user, isAuthenticated: true, isLoading: false });
        } catch (err) {
            console.error('Failed to decode credential:', err);
            set({ isLoading: false });
        }
    },

    logout: () => {
        localStorage.removeItem(STORAGE_KEY);
        set({ user: null, isAuthenticated: false });
        // Revoke Google session
        if (window.google?.accounts?.id) {
            window.google.accounts.id.disableAutoSelect();
        }
    },

    checkAuth: () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Require _credential for backend API authentication
                if (!parsed._credential) {
                    localStorage.removeItem(STORAGE_KEY);
                    set({ isLoading: false });
                    return;
                }
                // Check if JWT token has expired
                try {
                    const payload = decodeJwtPayload(parsed._credential);
                    const exp = (payload.exp as number) * 1000; // JWT exp is in seconds
                    if (Date.now() >= exp) {
                        console.warn('Auth token expired, clearing session');
                        localStorage.removeItem(STORAGE_KEY);
                        set({ isLoading: false });
                        return;
                    }
                } catch {
                    localStorage.removeItem(STORAGE_KEY);
                    set({ isLoading: false });
                    return;
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
