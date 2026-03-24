import apiClient from './client';
import type { Project, ApiResponse } from '../types';

// 创建项目
export const createProject = async (
  name: string,
  description?: string
): Promise<ApiResponse<Project>> => {
  const response = await apiClient.post<ApiResponse<Project>>('/projects', {
    name,
    description,
  });
  return response.data;
};

// 获取项目列表
export const getProjects = async (): Promise<ApiResponse<Project[]>> => {
  const response = await apiClient.get<ApiResponse<Project[]>>('/projects');
  return response.data;
};

// 获取单个项目
export const getProject = async (id: string): Promise<ApiResponse<Project>> => {
  const response = await apiClient.get<ApiResponse<Project>>(`/projects/${id}`);
  return response.data;
};

// 更新项目
export const updateProject = async (
  id: string,
  name?: string,
  description?: string
): Promise<ApiResponse<Project>> => {
  const response = await apiClient.patch<ApiResponse<Project>>(`/projects/${id}`, {
    name,
    description,
  });
  return response.data;
};

// 删除项目
export const deleteProject = async (id: string): Promise<ApiResponse<void>> => {
  const response = await apiClient.delete<ApiResponse<void>>(`/projects/${id}`);
  return response.data;
};

