import { Router } from 'express';
import * as controller from '../controllers/allocationController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.get('/', authorize('VOLUNTEER', 'RESCUE_LEAD', 'AUTHORITY', 'ADMIN'), controller.list);
router.get('/:id', authorize('VOLUNTEER', 'RESCUE_LEAD', 'AUTHORITY', 'ADMIN'), controller.get);
router.post('/', authorize('AUTHORITY', 'ADMIN'), controller.create);
router.patch('/:id', authorize('VOLUNTEER', 'RESCUE_LEAD', 'AUTHORITY', 'ADMIN'), controller.update);

export default router;
