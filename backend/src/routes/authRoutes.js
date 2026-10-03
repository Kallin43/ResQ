import { Router } from 'express';
import * as controller from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();
router.post('/register', controller.register);
router.post('/login', controller.login);
router.get('/me', authenticate, controller.getCurrentUser);
router.patch('/me', authenticate, controller.updateCurrentUser);

export default router;
