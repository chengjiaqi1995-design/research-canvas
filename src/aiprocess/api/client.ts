import axios from 'axios';

// 创建axios实例 - 生产环境使用相对路径，本地开发使用环境变量或默认端口
const getBaseURL = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  // 本地开发：优先使用环境变量，否则使用默认端口 8080
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    const devPort = import.meta.env.VITE_DEV_PORT || '8080';
    return `http://localhost:${devPort}/api`;
  }
  // 生产环境使用相对路径
  return '/api';
};

const apiClient = axios.create({
  baseURL: getBaseURL(),
  timeout: 300000, // 5分钟超时（音频处理可能需要较长时间）
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：添加 token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
