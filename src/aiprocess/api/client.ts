import axios from 'axios';
import {
  clearStoredAuthSession,
  getValidLegacyAuthToken,
  getValidStoredSessionToken,
  isReadOnlySession,
  isSessionAuthFailure,
} from '../../utils/sessionAuth.ts';

// 创建axios实例 - 始终使用相对路径，让 Vite proxy / Nginx 统一转发
const getBaseURL = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  // 统一使用相对路径：开发环境走 Vite proxy，生产走 Nginx proxy
  return '/api';
};

const apiClient = axios.create({
  baseURL: getBaseURL(),
  timeout: 300000, // 5分钟超时（音频处理可能需要较长时间）
  headers: {
    'Content-Type': 'application/json',
  },
});

const READONLY_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isAllowedReadOnlyRequest(method: string, url = ''): boolean {
  const path = url.split('?')[0];
  if (method === 'GET' && (path === '/upload/signed-url' || path === '/upload/audio-signed-url')) return false;
  if (READONLY_SAFE_METHODS.has(method)) return true;
  if (method === 'POST' && path === '/auth/logout') return true;
  if (method === 'POST' && path === '/knowledge-base/search') return true;
  if (method === 'POST' && /^\/feed\/[^/]+\/reference\/[^/]+$/.test(path)) return true;
  return false;
}

// 获取 Token 的统一方法，兼容主画板的数据结构
const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return (
    getValidStoredSessionToken({
      allowSessionToken: true,
      cleanupInvalid: true,
      normalizeSessionToken: true,
    }) ||
    getValidLegacyAuthToken({ cleanupInvalid: true })
  );
};

const getAuthHeaderToken = (): string | null => {
  const token = getToken();
  if (token) return token;
  return import.meta.env.DEV ? 'dev-token' : null;
};

// 请求拦截器：添加 token
apiClient.interceptors.request.use(
  (config) => {
    const method = (config.method || 'get').toUpperCase();
    const url = config.url || '';
    if (isReadOnlySession() && !isAllowedReadOnlyRequest(method, url)) {
      return Promise.reject(new Error('只读模式不能更改内容。请使用编辑账号登录后再操作。'));
    }

    const token = getAuthHeaderToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器：处理 401 未授权 + 冷启动重试
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const config = error.config;
    // 502/504 自动重试（Cloud Run 冷启动导致的网关超时）
    // 最多重试 2 次，每次间隔递增
    if (error.response && [502, 504].includes(error.response.status) && config && !config.__retryCount) {
      config.__retryCount = 0;
    }
    if (error.response && [502, 504].includes(error.response.status) && config && config.__retryCount < 2) {
      config.__retryCount++;
      const delay = config.__retryCount * 3000; // 3s, 6s
      console.log(`[API] ${error.response.status} 冷启动重试 ${config.__retryCount}/2，${delay/1000}秒后...`);
      await new Promise(r => setTimeout(r, delay));
      return apiClient(config);
    }

    const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || '请求失败';

    // 处理真正的 session 认证失败；外部数据源的 Unauthorized 不能踢用户下线。
    if (
      error.response?.status === 401 &&
      !import.meta.env.DEV &&
      isSessionAuthFailure(error.response.status, errorMessage)
    ) {
      // Token 过期或无效，清除本地存储并跳转到登录页
      clearStoredAuthSession(true);
      if (window.location.pathname !== '/login' && window.location.pathname !== '/auth/callback') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // 统一错误处理
    if (error.code === 'ECONNABORTED') {
      console.error('API 请求超时');
      return Promise.reject(new Error('请求超时，请稍后重试'));
    }
    if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
      console.error('网络错误 - 后端服务可能未启动或无法连接');
      const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
      const errorMsg = isLocal
        ? '无法连接到服务器，请检查本地 Vite /api 代理或 Cloud Run API 是否可用'
        : '无法连接到服务器，请稍后重试';
      return Promise.reject(new Error(errorMsg));
    }
    console.error('API Error:', errorMessage, error);
    return Promise.reject(error);
  }
);

export default apiClient;
