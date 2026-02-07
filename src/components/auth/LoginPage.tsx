import { useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore.ts';

const GOOGLE_CLIENT_ID = '208594497704-4urmpvbdca13v2ae3a0hbkj6odnhu8t1.apps.googleusercontent.com';

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (config: Record<string, unknown>) => void;
                    renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
                    prompt: () => void;
                    disableAutoSelect: () => void;
                };
            };
        };
    }
}

export function LoginPage() {
    const login = useAuthStore((s) => s.login);
    const buttonRef = useRef<HTMLDivElement>(null);
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;

        function initGsi() {
            if (!window.google?.accounts?.id || !buttonRef.current) return;
            initialized.current = true;

            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: (response: { credential: string }) => {
                    login(response.credential);
                },
                auto_select: true,
                itp_support: true,
            });

            window.google.accounts.id.renderButton(buttonRef.current, {
                type: 'standard',
                theme: 'outline',
                size: 'large',
                text: 'signin_with',
                shape: 'pill',
                width: 320,
                logo_alignment: 'left',
            });

            window.google.accounts.id.prompt();
        }

        // Wait for Google script to load
        if (window.google?.accounts?.id) {
            initGsi();
        } else {
            const interval = setInterval(() => {
                if (window.google?.accounts?.id) {
                    clearInterval(interval);
                    initGsi();
                }
            }, 100);
            return () => clearInterval(interval);
        }
    }, [login]);

    return (
        <div className="login-page">
            <div className="login-card">
                {/* Animated background orbs */}
                <div className="login-bg-orb login-bg-orb-1" />
                <div className="login-bg-orb login-bg-orb-2" />
                <div className="login-bg-orb login-bg-orb-3" />

                {/* Content */}
                <div className="login-content">
                    {/* Logo */}
                    <div className="login-logo">
                        <div className="login-logo-icon">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                                <polyline points="2 17 12 22 22 17" />
                                <polyline points="2 12 12 17 22 12" />
                            </svg>
                        </div>
                    </div>

                    <h1 className="login-title">Research Canvas</h1>
                    <p className="login-subtitle">投资研究画布工具</p>
                    <p className="login-desc">
                        供需分析 · 成本曲线 · 结构化研究模板
                    </p>

                    {/* Google Sign In Button */}
                    <div className="login-button-container">
                        <div ref={buttonRef} className="login-google-btn" />
                    </div>

                    <p className="login-footer">
                        使用 Google 账户登录以开始使用
                    </p>
                </div>
            </div>
        </div>
    );
}
