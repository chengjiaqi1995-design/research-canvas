import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import * as projectController from '../controllers/projectController';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// 所有路由都需要认证
router.use(authenticateToken as any);

// 创建项目
router.post('/', asyncHandler(projectController.createProject));

// 获取项目列表
router.get('/', asyncHandler(projectController.getProjects));

// 获取单个项目
router.get('/:id', asyncHandler(projectController.getProject));

// 更新项目
router.patch('/:id', asyncHandler(projectController.updateProject));

// 删除项目
router.delete('/:id', asyncHandler(projectController.deleteProject));

export default router;

