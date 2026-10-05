import { Router } from 'express';
import * as controller from '../controllers/resourceController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.get('/', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.list);
router.post('/', authorize('FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.create);
router.patch('/:id', authorize('FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.update);
router.delete('/:id', authorize('FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.remove);

export default router;
