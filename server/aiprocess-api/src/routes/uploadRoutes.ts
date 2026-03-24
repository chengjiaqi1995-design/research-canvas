import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import * as uploadController from '../controllers/uploadController';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// 获取文件上传签名 URL（需要认证）
router.get('/signed-url', authenticateToken, asyncHandler(uploadController.getSignedUploadUrl));

// 确认文件上传完成（需要认证）
router.post('/confirm', authenticateToken, asyncHandler(uploadController.confirmUpload));

// 获取实时录音上传签名 URL（需要认证）
router.get('/audio-signed-url', authenticateToken, asyncHandler(uploadController.getAudioUploadSignedUrl));

export default router;

