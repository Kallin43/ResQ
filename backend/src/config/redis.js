import { createClient } from 'redis';

let redisClient;

export function getRedisClient() {
  return redisClient?.isReady ? redisClient : null;
}

export async function connectRedis() {
  if (!process.env.REDIS_URL) {
    console.warn('Redis is not connected: set REDIS_URL in backend/.env.');
    return false;
  }
  if (redisClient?.isReady) return true;

  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: { reconnectStrategy: (retries) => (retries > 3 ? new Error('Redis connection retries exhausted.') : Math.min(retries * 250, 1000)) },
  });
  redisClient.on('error', (error) => console.error('Redis connection error:', error.message));
  try {
    await redisClient.connect();
    console.log('Redis connected.');
    return true;
  } catch (error) {
    console.error('Redis connection failed:', error.message);
    redisClient = undefined;
    return false;
  }
}

export async function disconnectRedis() {
  if (redisClient?.isOpen) await redisClient.quit();
  redisClient = undefined;
}
