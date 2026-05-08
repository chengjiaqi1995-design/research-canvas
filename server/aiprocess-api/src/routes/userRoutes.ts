import express from 'express';
import { authenticateToken, requireEditor, requireEditorForWrite } from '../middleware/auth';
import * as userController from '../controllers/userController';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// 获取用户的自定义行业列表
router.get('/industries', authenticateToken, asyncHandler(userController.getIndustries as any));

// 添加新行业
router.post('/industries', authenticateToken, requireEditorForWrite, asyncHandler(userController.addIndustry as any));

// 删除行业
router.delete('/industries', authenticateToken, requireEditorForWrite, asyncHandler(userController.deleteIndustry as any));

// 批量重置行业列表（传入完整列表替换）
router.put('/industries/reset', authenticateToken, requireEditorForWrite, asyncHandler(userController.resetIndustries as any));
// 获取所有用户日志
router.get('/all', authenticateToken, requireEditor, asyncHandler(userController.getAllUsers as any));

// 应用级只读访问账号管理
router.get('/access-rules', authenticateToken, requireEditor, asyncHandler(userController.getAccessRules as any));
router.post('/access-rules', authenticateToken, requireEditor, asyncHandler(userController.upsertAccessRule as any));
router.delete('/access-rules/:email', authenticateToken, requireEditor, asyncHandler(userController.deleteAccessRuleByEmail as any));

export default router;






