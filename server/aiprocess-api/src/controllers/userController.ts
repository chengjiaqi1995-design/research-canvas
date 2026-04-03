import { Request, Response } from 'express';
import prisma from '../utils/db';
import type { ApiResponse } from '../types';

/**
 * 获取用户的自定义行业列表
 */
export async function getIndustries(req: Request, res: Response) {
  const userId = req.userId!;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { customIndustries: true },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      error: '用户不存在',
    } as ApiResponse);
  }

  const industries = JSON.parse(user.customIndustries || '[]');

  return res.json({
    success: true,
    data: { industries },
  } as ApiResponse);
}

/**
 * 添加新行业
 */
export async function addIndustry(req: Request, res: Response) {
  const userId = req.userId!;
  const { industry } = req.body;

  if (!industry || typeof industry !== 'string' || industry.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: '行业名称不能为空',
    } as ApiResponse);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { customIndustries: true },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      error: '用户不存在',
    } as ApiResponse);
  }

  const industries = JSON.parse(user.customIndustries || '[]');
  const trimmedIndustry = industry.trim();

  // 检查是否已存在
  if (industries.includes(trimmedIndustry)) {
    return res.status(400).json({
      success: false,
      error: '该行业已存在',
    } as ApiResponse);
  }

  industries.push(trimmedIndustry);

  await prisma.user.update({
    where: { id: userId },
    data: { customIndustries: JSON.stringify(industries) },
  });

  return res.json({
    success: true,
    data: { industries },
    message: '添加成功',
  } as ApiResponse);
}

/**
 * 删除行业
 */
export async function deleteIndustry(req: Request, res: Response) {
  const userId = req.userId!;
  const { industry } = req.body;

  if (!industry || typeof industry !== 'string') {
    return res.status(400).json({
      success: false,
      error: '行业名称不能为空',
    } as ApiResponse);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { customIndustries: true },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      error: '用户不存在',
    } as ApiResponse);
  }

  const industries = JSON.parse(user.customIndustries || '[]');
  const filteredIndustries = industries.filter((i: string) => i !== industry);

  await prisma.user.update({
    where: { id: userId },
    data: { customIndustries: JSON.stringify(filteredIndustries) },
  });

  return res.json({
    success: true,
    data: { industries: filteredIndustries },
    message: '删除成功',
  } as ApiResponse);
}

/**
 * 批量重置行业列表
 * PUT /api/user/industries/reset
 * Body: { industries: string[] }
 *
 * 将用户的行业分类替换为传入的列表（去重），不动任何笔记
 */
export async function resetIndustries(req: Request, res: Response) {
  const userId = req.userId!;
  const { industries } = req.body as { industries?: string[] };

  if (!industries || !Array.isArray(industries) || industries.length === 0) {
    return res.status(400).json({
      success: false,
      error: '请提供行业列表 industries[]',
    } as ApiResponse);
  }

  // 去重 & 去空
  const unique = [...new Set(industries.map(i => i.trim()).filter(i => i.length > 0))];

  await prisma.user.update({
    where: { id: userId },
    data: { customIndustries: JSON.stringify(unique) },
  });

  return res.json({
    success: true,
    data: { industries: unique },
    message: `行业列表已更新（${unique.length} 个行业）`,
  } as ApiResponse);
}









/**
 * 获取系统中所有的用户（供管理员 / 活动面板查看全量登录日志使用）
 * 按照更新/活跃时间倒序返回
 */
export async function getAllUsers(req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return res.json({
      success: true,
      data: { users },
    } as ApiResponse);
  } catch (error: any) {
    console.error('获取所有用户失败:', error);
    return res.status(500).json({
      success: false,
      error: '获取用户列表失败',
    } as ApiResponse);
  }
}
