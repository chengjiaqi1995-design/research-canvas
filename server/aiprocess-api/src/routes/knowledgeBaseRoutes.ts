import { Router } from 'express';
import { authenticateToken, requireEditorForWrite } from '../middleware/auth';
import * as knowledgeBaseController from '../controllers/knowledgeBaseController';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// 应用认证中间件到所有路由
router.use(authenticateToken as any);
router.use(requireEditorForWrite as any);

router.get('/status', asyncHandler(knowledgeBaseController.getKnowledgeBaseStatus));
router.get('/index-progress', asyncHandler(knowledgeBaseController.getIndexProgress));
router.post('/search', asyncHandler(knowledgeBaseController.searchKnowledgeBase));
router.post('/notebooklm/query', asyncHandler(knowledgeBaseController.queryNotebookLm));
router.post('/sync', asyncHandler(knowledgeBaseController.syncAllTranscriptions));
router.post('/index/:id', asyncHandler(knowledgeBaseController.indexTranscription));
router.delete('/index/:id', asyncHandler(knowledgeBaseController.deleteIndex));

export default router;
