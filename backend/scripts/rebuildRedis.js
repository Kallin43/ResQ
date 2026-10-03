import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { connectRedis, disconnectRedis } from '../src/config/redis.js';
import { rebuildRedisFromMongo } from '../src/services/redisSyncService.js';

let mongoConnected = false;
let redisConnected = false;
try {
  mongoConnected = await connectDatabase();
  if (!mongoConnected) throw new Error('Could not connect to MongoDB Atlas.');
  redisConnected = await connectRedis();
  if (!redisConnected) throw new Error('Could not connect to Redis. Set REDIS_URL in backend/.env.');
  const result = await rebuildRedisFromMongo();
  console.log('Rebuilt Redis operational state from MongoDB:', result);
} catch (error) {
  console.error(`Redis rebuild failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (redisConnected) await disconnectRedis();
  if (mongoConnected) await disconnectDatabase();
}
