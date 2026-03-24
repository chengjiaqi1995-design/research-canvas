import express from 'express';
import { translate } from '../controllers/translationController';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// 翻译文本到中文
router.post('/translate', authenticateToken, asyncHandler(translate));

export default router;


