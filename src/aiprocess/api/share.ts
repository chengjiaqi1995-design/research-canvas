import client from './client';
import axios from 'axios';

export async function createShare(
  title: string, 
  content: string, 
  expiresIn?: number,
  requireAuth?: boolean,
  isPublic?: boolean,
  allowedUsers?: string[],
  maxAccessUsers?: number
) {
  return client.post('/share/create', { 
    title, 
    content, 
    expiresIn,
    requireAuth,
    isPublic,
    allowedUsers,
    maxAccessUsers,
  });
}

export async function getSharedContent(shareToken: string) {
  // 公开访问，但可能需要认证（可选）
  // 使用与 client.ts 相同的 baseURL 逻辑，确保生产环境一致性
  const getBaseURL = () => {
    if (import.meta.env.VITE_API_BASE_URL) {
      return import.meta.env.VITE_API_BASE_URL;
    }
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      const devPort = import.meta.env.VITE_DEV_PORT || '8080';
      return `http://localhost:${devPort}/api`;
    }
    // 生产环境使用相对路径（如果前端和后端在同一域名）或绝对路径
    return '/api';
  };
  
  const baseURL = getBaseURL();
  
  // 尝试从 localStorage 获取 token（兼容两种 token 存储方式）
  const authToken = localStorage.getItem('auth_token') || localStorage.getItem('token');
  const headers: any = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  try {
    return await axios.get(`${baseURL}/share/${shareToken}`, { headers });
  } catch (error: any) {
    if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
      const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
      const errorMsg = isLocal 
        ? '无法连接到服务器，请确保后端服务已启动（http://localhost:8080）'
        : '无法连接到服务器，请稍后重试';
      throw new Error(errorMsg);
    }
    throw error;
  }
}

export async function getDynamicShareData(shareToken: string) {
  // 公开访问，但可能需要认证（可选）
  // 使用与 client.ts 相同的 baseURL 逻辑，确保生产环境一致性
  const getBaseURL = () => {
    if (import.meta.env.VITE_API_BASE_URL) {
      return import.meta.env.VITE_API_BASE_URL;
    }
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      const devPort = import.meta.env.VITE_DEV_PORT || '8080';
      return `http://localhost:${devPort}/api`;
    }
    // 生产环境使用相对路径（如果前端和后端在同一域名）或绝对路径
    return '/api';
  };
  
  const baseURL = getBaseURL();
  
  // 尝试从 localStorage 获取 token（兼容两种 token 存储方式）
  const authToken = localStorage.getItem('auth_token') || localStorage.getItem('token');
  const headers: any = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  return axios.get(`${baseURL}/share/${shareToken}/data`, { headers });
}

export async function updateShareSettings(shareToken: string, settings: {
  requireAuth?: boolean;
  isPublic?: boolean;
  allowedUsers?: string[];
}) {
  return client.patch(`/share/${shareToken}/settings`, settings);
}

export async function getAccessLogs(shareToken: string, page: number = 1, pageSize: number = 20, userId?: string) {
  const params: any = { page, pageSize };
  if (userId) {
    params.userId = userId;
  }
  return client.get(`/share/${shareToken}/access-logs`, { params });
}

export async function revokeAccess(shareToken: string, targetUserId: string) {
  return client.post(`/share/${shareToken}/revoke-access`, { targetUserId });
}

export async function getMyShares() {
  return client.get('/share/my/list');
}

export async function deleteShare(id: string) {
  return client.delete(`/share/${id}`);
}


