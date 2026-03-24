import express from 'express';
import {
  createShare,
  getSharedContent,
  getMyShares,
  deleteShare,
  getDynamicShareData,
  updateShareSettings,
  getAccessLogs,
  revokeAccess,
} from '../controllers/shareController';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// 创建分享（需要认证）
router.post('/create', authenticateToken, asyncHandler(createShare));

// 获取分享内容（公开访问，但需要可选认证以检查权限）
router.get('/:token', optionalAuthenticateToken, asyncHandler(getSharedContent));

// 获取动态分享数据（公开访问，但需要可选认证以检查权限）
router.get('/:token/data', optionalAuthenticateToken, asyncHandler(getDynamicShareData));

// 更新分享设置（需要认证）
router.patch('/:token/settings', authenticateToken, asyncHandler(updateShareSettings));

// 获取访问日志（需要认证）
router.get('/:token/access-logs', authenticateToken, asyncHandler(getAccessLogs));

// 撤销访问权限（需要认证）
router.post('/:token/revoke-access', authenticateToken, asyncHandler(revokeAccess));

// 获取我的分享列表（需要认证）
router.get('/my/list', authenticateToken, asyncHandler(getMyShares));

// 删除分享（需要认证）
router.delete('/:id', authenticateToken, asyncHandler(deleteShare));

export default router;


