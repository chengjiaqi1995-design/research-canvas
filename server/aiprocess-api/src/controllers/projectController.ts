import { Request, Response } from 'express';
import prisma from '../utils/db';
import type { ApiResponse, PaginatedResponse } from '../types';

/**
 * 创建项目
 */
export async function createProject(req: Request, res: Response) {
  const userId = req.userId!;
  const { name, description } = req.body as { name: string; description?: string };

  if (!name || name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: '项目名称不能为空',
    } as ApiResponse);
  }

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      userId, // 关联到当前用户
    },
  });

  return res.status(201).json({
    success: true,
    data: project,
    message: '项目创建成功',
  } as ApiResponse);
}

/**
 * 获取项目列表
 */
export async function getProjects(req: Request, res: Response) {
  const userId = req.userId!;
  const projects = await prisma.project.findMany({
    where: { userId }, // 只获取当前用户的项目
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { transcriptions: true },
      },
    },
  });

  return res.json({
    success: true,
    data: projects.map(project => ({
      ...project,
      transcriptionCount: project._count.transcriptions,
    })),
  } as ApiResponse);
}

/**
 * 获取单个项目详情
 */
export async function getProject(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const project = await prisma.project.findFirst({
    where: {
      id,
      userId, // 确保只能访问自己的项目
    },
    include: {
      _count: {
        select: { transcriptions: true },
      },
    },
  });

  if (!project) {
    return res.status(404).json({
      success: false,
      error: '项目不存在',
    } as ApiResponse);
  }

  return res.json({
    success: true,
    data: {
      ...project,
      transcriptionCount: project._count.transcriptions,
    },
  } as ApiResponse);
}

/**
 * 更新项目
 */
export async function updateProject(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { name, description } = req.body as { name?: string; description?: string };

  const project = await prisma.project.findFirst({
    where: {
      id,
      userId, // 确保只能更新自己的项目
    },
  });

  if (!project) {
    return res.status(404).json({
      success: false,
      error: '项目不存在',
    } as ApiResponse);
  }

  const updateData: any = {};
  if (name !== undefined) {
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: '项目名称不能为空',
      } as ApiResponse);
    }
    updateData.name = name.trim();
  }
  if (description !== undefined) {
    updateData.description = description?.trim() || null;
  }

  const updatedProject = await prisma.project.update({
    where: { id },
    data: updateData,
  });

  return res.json({
    success: true,
    data: updatedProject,
    message: '项目更新成功',
  } as ApiResponse);
}

/**
 * 删除项目
 */
export async function deleteProject(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const project = await prisma.project.findFirst({
    where: {
      id,
      userId, // 确保只能删除自己的项目
    },
  });

  if (!project) {
    return res.status(404).json({
      success: false,
      error: '项目不存在',
    } as ApiResponse);
  }

  // 删除项目（关联的转录记录的 projectId 会自动设置为 null）
  await prisma.project.delete({
    where: { id },
  });

  return res.json({
    success: true,
    message: '项目删除成功',
  } as ApiResponse);
}
