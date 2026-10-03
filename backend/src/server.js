import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { closeNeo4j } from './config/neo4j.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import alertRoutes from './routes/alertRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import allocationRoutes from './routes/allocationRoutes.js';
import authRoutes from './routes/authRoutes.js';
import facilityRoutes from './routes/facilityRoutes.js';
import healthRouter from './routes/health.js';
import incidentRoutes from './routes/incidentRoutes.js';
import dispatchRoutes from './routes/dispatchRoutes.js';
import resourceRoutes from './routes/resourceRoutes.js';
import roadRoutes from './routes/roadRoutes.js';
import { configureRealtime } from './realtime.js';
import { hydrateLiveIncidentQueue } from './services/operationalStateService.js';
import { hydrateActiveAlerts, pruneExpiredActiveAlerts } from './services/alertService.js';
import { startMongoSynchronization, stopMongoSynchronization } from './services/mongoSyncService.js';

const app = express();
const httpServer = createServer(app);
const allowedOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? allowedOrigin
  : [...new Set([allowedOrigin, 'http://localhost:5173', 'http://localhost:5174'])];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/health', healthRouter);
app.use('/api/auth', authRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/facilities', facilityRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/roads', roadRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use(notFound);
app.use(errorHandler);

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins },
});

const port = Number(process.env.PORT ?? 4000);

const mongoConnected = await connectDatabase();
await connectRedis();
await hydrateLiveIncidentQueue().catch((error) => console.error('Redis incident queue hydration failed:', error.message));
await hydrateActiveAlerts().catch((error) => console.error('Redis active alert hydration failed:', error.message));
const alertExpiryCleanup = setInterval(() => {
  pruneExpiredActiveAlerts().catch((error) => console.error('Redis active alert cleanup failed:', error.message));
}, 60_000);
alertExpiryCleanup.unref();
const redisSubscriber = await configureRealtime(io).catch((error) => {
  console.error('Redis Pub/Sub subscription failed:', error.message);
  return null;
});
if (mongoConnected) {
  await startMongoSynchronization().catch((error) => console.error('MongoDB change-stream synchronization could not start:', error.message));
}

httpServer.listen(port, () => {
  console.log(`ResQ API listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    httpServer.close(async () => {
      if (redisSubscriber?.isOpen) await redisSubscriber.quit();
      await stopMongoSynchronization();
      await closeNeo4j();
      await disconnectRedis();
      await disconnectDatabase();
      process.exit(0);
    });
  });
}
