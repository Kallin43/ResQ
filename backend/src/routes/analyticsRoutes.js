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
router.get('/dashboard', controller.dashboard);
router.get('/incidents/trend', controller.trend);
router.get('/incidents/size-buckets', controller.sizeBuckets);
router.get('/zones/hotspots', controller.hotspots);
router.get('/facilities/nearest', controller.nearestFacilities);
router.get('/allocations/response-times', controller.responseTimes);
router.get('/responders/skills', controller.skillCoverage);
router.get('/resources/low-stock', controller.lowStock);
router.get('/indexes', controller.indexes);
router.get('/redis', controller.redis);
router.get('/explain', controller.explainList);
router.get('/explain/:name', controller.explain);

export default router;
