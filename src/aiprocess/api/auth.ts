import apiClient from './client';
import type { ApiResponse } from '../types';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: string;
}

/**
 * 获取当前用户信息
 */
export const getCurrentUser = async (): Promise<ApiResponse<User>> => {
  const response = await apiClient.get<ApiResponse<User>>('/auth/me');
  return response.data;
};

/**
 * 登出
 */
export const logout = async (): Promise<ApiResponse<void>> => {
  const response = await apiClient.post<ApiResponse<void>>('/auth/logout');
  return response.data;
};


