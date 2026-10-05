import { Router } from 'express';
import * as controller from '../controllers/facilityController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.get('/', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.list);
router.get('/nearby', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.nearby);
router.get('/search', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.search);
router.get('/:id', authorize('CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.get);
router.post('/', authorize('AUTHORITY', 'ADMIN'), controller.create);
router.patch('/:id', authorize('FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'), controller.update);
router.delete('/:id', authorize('AUTHORITY', 'ADMIN'), controller.remove);

export default router;
