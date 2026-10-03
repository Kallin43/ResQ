import { Router } from 'express';
import * as controller from '../controllers/analyticsController.js';
import { authenticate, authorize } from '../middleware/authenticate.js';

const router = Router();
router.use(authenticate, authorize('AUTHORITY', 'ADMIN'));
router.get('/incidents/by-type', controller.incidentsByType);
router.get('/incidents/by-severity', controller.incidentsBySeverity);
router.get('/incidents/by-status', controller.incidentsByStatus);
router.get('/incidents/by-zone', controller.incidentsByZone);
router.get('/resources/availability', controller.resourceAvailability);
router.get('/allocations/by-status', controller.allocationsByStatus);
router.get('/facilities/utilization', controller.facilityUtilization);

export default router;
