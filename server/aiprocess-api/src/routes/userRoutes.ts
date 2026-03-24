import express from 'express';
import { authenticateToken } from '../middleware/auth';
import * as userController from '../controllers/userController';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// 获取用户的自定义行业列表
router.get('/industries', authenticateToken, asyncHandler(userController.getIndustries as any));

// 添加新行业
router.post('/industries', authenticateToken, asyncHandler(userController.addIndustry as any));

// 删除行业
router.delete('/industries', authenticateToken, asyncHandler(userController.deleteIndustry as any));

// 批量重置行业列表（传入完整列表替换）
router.put('/industries/reset', authenticateToken, asyncHandler(userController.resetIndustries as any));

export default router;








