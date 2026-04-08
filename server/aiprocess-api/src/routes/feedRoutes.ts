import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import * as feedCtrl from '../controllers/feedController';

const router = Router();
router.use(authenticateToken as any);

router.get('/', asyncHandler(feedCtrl.list));
router.post('/', asyncHandler(feedCtrl.create));
router.patch('/:id', asyncHandler(feedCtrl.update));
router.delete('/:id', asyncHandler(feedCtrl.remove));
router.post('/mark-all-read', asyncHandler(feedCtrl.markAllRead));

export default router;
