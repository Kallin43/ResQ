import { Router } from 'express';
import * as controller from '../controllers/roadController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate, authorize('AUTHORITY', 'ADMIN'));
router.get('/', controller.list);
router.post('/', controller.create);
router.patch('/:roadId/status', controller.updateStatus);
router.get('/:roadId', controller.get);
router.patch('/:roadId', controller.update);
router.delete('/:roadId', controller.remove);

export default router;
