import { Router } from 'express';
import * as controller from '../controllers/incidentController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.post('/', authorize('CITIZEN'), controller.create);
router.get('/', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'AUTHORITY', 'ADMIN'), controller.list);
router.get('/:id', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'AUTHORITY', 'ADMIN'), controller.get);
router.patch('/:id/status', authorize('AUTHORITY', 'ADMIN'), controller.updateStatus);

export default router;
