import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import * as wikiCtrl from '../controllers/wikiController';

const router = Router();
router.use(authenticateToken as any);

// Bulk endpoints (backward compatible with existing client)
router.get('/', asyncHandler(wikiCtrl.getAll));
router.put('/', asyncHandler(wikiCtrl.saveAll));

// Granular article CRUD (for MCP / agent use)
router.get('/articles', asyncHandler(wikiCtrl.listArticles));
router.post('/articles', asyncHandler(wikiCtrl.createArticle));
router.get('/articles/:id', asyncHandler(wikiCtrl.getArticle));
router.put('/articles/:id', asyncHandler(wikiCtrl.updateArticle));
router.patch('/articles/:id/section', asyncHandler(wikiCtrl.editSection));
router.delete('/articles/:id', asyncHandler(wikiCtrl.deleteArticle));

// Action log
router.get('/actions', asyncHandler(wikiCtrl.listActions));
router.post('/actions', asyncHandler(wikiCtrl.createAction));

export default router;
