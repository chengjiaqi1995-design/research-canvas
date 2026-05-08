import { useEffect, useRef, useState } from 'react';
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
    const loginError = useAuthStore((s) => s.loginError);
    const [loginMode, setLoginMode] = useState<'default' | 'viewer'>('default');
    const loginModeRef = useRef<'default' | 'viewer'>('default');
    const buttonRef = useRef<HTMLDivElement>(null);
    const initialized = useRef(false);
    const useServerOAuth = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

    useEffect(() => {
        loginModeRef.current = loginMode;
    }, [loginMode]);

    useEffect(() => {
        if (useServerOAuth) return;
        if (initialized.current) return;

        function initGsi() {
            if (!window.google?.accounts?.id || !buttonRef.current) return;
            initialized.current = true;

            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: (response: { credential: string }) => {
                    login(response.credential, loginModeRef.current);
                },
                auto_select: false,
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
    }, [login, useServerOAuth]);

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

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px',
                        width: '320px',
                        maxWidth: '100%',
                        margin: '6px auto 14px',
                    }}>
                        {[
                            { key: 'default' as const, label: '我的空间' },
                            { key: 'viewer' as const, label: '只读看 Jiaqi' },
                        ].map(option => {
                            const active = loginMode === option.key;
                            return (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setLoginMode(option.key)}
                                    style={{
                                        height: '34px',
                                        borderRadius: '999px',
                                        border: active ? '1px solid #2563eb' : '1px solid #cbd5e1',
                                        background: active ? '#eff6ff' : '#fff',
                                        color: active ? '#1d4ed8' : '#475569',
                                        fontSize: '13px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Google Sign In Button */}
                    <div className="login-button-container">
                        {useServerOAuth ? (
                            <button
                                type="button"
                                className="login-google-btn"
                                onClick={() => {
                                    window.location.href = `/api/auth/google?mode=${loginMode}`;
                                }}
                            >
                                <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '18px',
                                    height: '18px',
                                    marginRight: '10px',
                                    borderRadius: '50%',
                                    background: '#fff',
                                    color: '#4285f4',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    lineHeight: 1,
                                }}>
                                    G
                                </span>
                                使用 Google 账号登录
                            </button>
                        ) : (
                            <div ref={buttonRef} className="login-google-btn" />
                        )}
                    </div>

                    {loginError && (
                        <div style={{
                            marginTop: '16px',
                            padding: '10px 16px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '8px',
                            color: '#dc2626',
                            fontSize: '13px',
                            textAlign: 'center',
                            maxWidth: '320px',
                        }}>
                            {loginError}
                        </div>
                    )}

                    <p className="login-footer" style={{ marginTop: '32px', fontSize: '11px', opacity: 0.5 }}>
                        Designed by JQ
                    </p>
                </div>
            </div>
        </div>
    );
}
