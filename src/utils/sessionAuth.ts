export const AUTH_STORAGE_KEY = 'rc_auth_user';
export const LEGACY_AUTH_TOKEN_KEY = 'auth_token';

type StoredAuthRecord = Record<string, unknown>;

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return decodeURIComponent(
    binary
      .split('')
      .map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`)
      .join('')
  );
}

export function decodeSessionJwtPayload(token: string): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

export function isSessionJwt(token: unknown): token is string {
  return typeof token === 'string' && decodeSessionJwtPayload(token) !== null;
}

export function isExpiredSessionJwt(token: string): boolean {
  const payload = decodeSessionJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === 'number' && Date.now() >= exp * 1000;
}

export function readStoredAuthRecord(): StoredAuthRecord | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearStoredAuthSession(includeLegacy = false) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  if (includeLegacy) {
    window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
    window.localStorage.removeItem('user');
  }
}

export function getValidStoredSessionToken(options: {
  allowSessionToken?: boolean;
  allowDevToken?: boolean;
  cleanupInvalid?: boolean;
  normalizeSessionToken?: boolean;
} = {}): string | null {
  if (typeof window === 'undefined') return null;
  const record = readStoredAuthRecord();
  if (!record) {
    if (options.cleanupInvalid && window.localStorage.getItem(AUTH_STORAGE_KEY)) {
      clearStoredAuthSession(false);
    }
    return null;
  }

  const credential = record._credential;
  if (options.allowDevToken && credential === 'dev-token') return 'dev-token';
  if (isSessionJwt(credential)) return credential;

  const sessionToken = record.sessionToken;
  if (options.allowSessionToken && isSessionJwt(sessionToken)) {
    if (options.normalizeSessionToken) {
      window.localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({ ...record, _credential: sessionToken })
      );
    }
    return sessionToken;
  }

  if (options.cleanupInvalid) {
    clearStoredAuthSession(false);
  }
  return null;
}

export function getValidLegacyAuthToken(options: { cleanupInvalid?: boolean } = {}): string | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem(LEGACY_AUTH_TOKEN_KEY);
  if (!token) return null;
  if (isSessionJwt(token)) return token;
  if (options.cleanupInvalid) window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY);
  return null;
}

export function isReadOnlySession(): boolean {
  if (typeof window === 'undefined') return false;
  const token = getValidStoredSessionToken({
    allowSessionToken: true,
    cleanupInvalid: false,
    normalizeSessionToken: false,
  });
  const payload = token ? decodeSessionJwtPayload(token) : null;
  if (payload?.readOnly === true || payload?.role === 'viewer') return true;

  const record = readStoredAuthRecord();
  return record?.readOnly === true || record?.role === 'viewer';
}

export function isSessionAuthFailure(status: number | undefined, message: unknown): boolean {
  if (status !== 401 || typeof message !== 'string') return false;
  return [
    'Invalid or expired token',
    'Session token is missing Canvas user identity',
    'Missing authorization token',
    'Token 无效或已过期',
    'Token中缺少用户ID',
    '未提供认证Token',
    '未认证',
  ].some((needle) => message.includes(needle));
}
