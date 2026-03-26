import axios from 'axios';

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

// 获取 Token 的统一方法，兼容主画板的数据结构
const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    const rcStored = localStorage.getItem('rc_auth_user');
    if (rcStored) {
      const parsed = JSON.parse(rcStored);
      if (parsed._credential) return parsed._credential;
    }
  } catch (e) {
    // 忽略解析错误
  }
  return localStorage.getItem('auth_token');
};

// 请求拦截器：添加 token
apiClient.interceptors.request.use(
  (config) => {
    if (import.meta.env.DEV) {
      // 本地开发始终使用 dev-token（本地 JWT 无法被验证）
      config.headers.Authorization = 'Bearer dev-token';
    } else {
      const token = getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器：处理 401 未授权
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // 处理 401 未授权（开发模式下跳过，因为本地 JWT 无法被线上 API 验证）
    if (error.response?.status === 401 && !import.meta.env.DEV) {
      // Token 过期或无效，清除本地存储并跳转到登录页
      localStorage.removeItem('rc_auth_user');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
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
        ? '无法连接到服务器，请确保后端服务已启动（http://localhost:8080）'
        : '无法连接到服务器，请稍后重试';
      return Promise.reject(new Error(errorMsg));
    }
    const errorMessage = error.response?.data?.error || error.message || '请求失败';
    console.error('API Error:', errorMessage, error);
    return Promise.reject(error);
  }
);

export default apiClient;
