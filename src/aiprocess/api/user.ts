import apiClient from './client';
import type { ApiResponse } from '../types';

/**
 * 获取用户的自定义行业列表
 */
export async function getIndustries(): Promise<ApiResponse<{ industries: string[] }>> {
  const response = await apiClient.get('/user/industries');
  return response.data;
}

/**
 * 添加新行业
 */
export async function addIndustry(industry: string): Promise<ApiResponse<{ industries: string[] }>> {
  const response = await apiClient.post('/user/industries', { industry });
  return response.data;
}

/**
 * 删除行业
 */
export async function deleteIndustry(industry: string): Promise<ApiResponse<{ industries: string[] }>> {
  const response = await apiClient.delete('/user/industries', { data: { industry } });
  return response.data;
}

/**
 * 批量重置行业列表（替换为新列表，不动笔记）
 */
export async function resetIndustries(industries: string[]): Promise<ApiResponse<{ industries: string[] }>> {
  const response = await apiClient.put('/user/industries/reset', { industries });
  return response.data;
}








