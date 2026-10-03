import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedisClient } from '../config/redis.js';
import { getNeo4jDriver } from '../config/neo4j.js';

const router = Router();

router.get('/', async (_request, response) => {
  const neo4j = await getNeo4jDriver().then(() => 'connected').catch(() => 'disconnected');
  response.json({
    status: 'ok',
    service: 'resq-backend',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: getRedisClient() ? 'connected' : 'disconnected',
    neo4j,
  });
});

export default router;
