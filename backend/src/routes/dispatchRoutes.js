import { Router } from 'express';
import * as controller from '../controllers/dispatchController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate);
router.get('/candidates/:incidentId', authorize('RESCUE_LEAD', 'AUTHORITY', 'ADMIN'), controller.candidates);

export default router;
