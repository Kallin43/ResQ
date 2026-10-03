import { Router } from 'express';
import * as controller from '../controllers/alertController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.get('/', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.list);
router.post('/', authorize('AUTHORITY', 'ADMIN'), controller.create);
router.patch('/:id/expire', authorize('AUTHORITY', 'ADMIN'), controller.expire);

export default router;
