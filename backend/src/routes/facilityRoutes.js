import { Router } from 'express';
import * as controller from '../controllers/facilityController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.get('/', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.list);
router.get('/:id', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.get);
router.post('/', authorize('AUTHORITY', 'ADMIN'), controller.create);
router.patch('/:id', authorize('FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.update);

export default router;
