import { Router } from 'express';
import { authenticateToken, requireEditorForWrite } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import * as overviewCtrl from '../controllers/overviewController';

const router = Router();

router.use(authenticateToken as any);
router.use(requireEditorForWrite as any);

router.get('/db-daily', asyncHandler(overviewCtrl.getDbDailyOverview));
router.post('/activity-event', asyncHandler(overviewCtrl.createActivityEvent));

export default router;
