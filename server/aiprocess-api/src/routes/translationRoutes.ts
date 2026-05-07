import express from 'express';
import { translate } from '../controllers/translationController';
import { authenticateToken, requireEditorForWrite } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// 翻译文本到中文
router.post('/translate', authenticateToken, requireEditorForWrite, asyncHandler(translate));

export default router;

