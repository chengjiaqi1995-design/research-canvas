import { Router } from 'express';
import { authenticateToken, requireEditorForWrite } from '../middleware/auth';
import * as backupController from '../controllers/backupController';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// 所有路由都需要认证
router.use(authenticateToken as any);
router.use(requireEditorForWrite as any);

// 导出备份（下载 ZIP）
router.get('/export', asyncHandler(backupController.exportBackup));

export default router;
