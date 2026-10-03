import { Alert, Allocation, Facility, Incident, Resource, Road, User } from '../models/index.js';
import { rebuildRedisFromMongo, syncResponderFromMongo } from './redisSyncService.js';
import { rebuildNeo4jFromMongo } from '../../scripts/seedGraph.js';

const models = { users: User, incidents: Incident, facilities: Facility, resources: Resource, allocations: Allocation, alerts: Alert, roads: Road };
const pending = { redis: false, neo4j: false };
let timer;
let running = false;
let streams = [];
let retryDelayMs = 5000;
let lastFailureLogAt = 0;
const neo4jConfigured = Boolean(process.env.NEO4J_URI && process.env.NEO4J_USERNAME && process.env.NEO4J_PASSWORD);

function schedule({ redis = false, neo4j = false, delayMs = 750 } = {}) {
  pending.redis ||= redis;
  pending.neo4j ||= neo4j;
  if (retryDelayMs > 5000 && (pending.redis || pending.neo4j)) delayMs = Math.max(delayMs, retryDelayMs);
  clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, delayMs);
}

async function flush() {
  if (running) return;
  running = true;
  let retryRedis = false;
  let retryNeo4j = false;
  try {
    while (pending.redis || pending.neo4j) {
      const syncRedis = pending.redis;
      const syncNeo4j = pending.neo4j;
      pending.redis = false;
      pending.neo4j = false;
      if (syncRedis) {
        try {
          const result = await rebuildRedisFromMongo({ preservePresence: true });
          console.info('Synchronized Redis derived state from MongoDB:', result);
        } catch (error) {
          logSyncFailure('MongoDB-to-Redis synchronization failed:', error);
          retryRedis = true;
          pending.neo4j ||= syncNeo4j;
          break;
        }
      }
      if (syncNeo4j) {
        try {
          await rebuildNeo4jFromMongo();
        } catch (error) {
          logSyncFailure('MongoDB-to-Neo4j synchronization failed:', error);
          retryNeo4j = true;
          break;
        }
      }
    }
  } finally {
    running = false;
    pending.redis ||= retryRedis;
    pending.neo4j ||= retryNeo4j;
    if (retryRedis || retryNeo4j) {
      schedule({ delayMs: retryDelayMs });
      retryDelayMs = Math.min(retryDelayMs * 2, 60000);
    } else if (pending.redis || pending.neo4j) {
      retryDelayMs = 5000;
      schedule({ delayMs: 750 });
    } else {
      retryDelayMs = 5000;
    }
  }
}

function logSyncFailure(label, error) {
  const now = Date.now();
  if (now - lastFailureLogAt >= 60000) {
    console.error(label, error.message);
    lastFailureLogAt = now;
  }
}

function handleChange(collectionName, change) {
  if (collectionName === 'users') {
    const responderId = change.documentKey?._id;
    if (responderId) {
      syncResponderFromMongo(responderId).catch((error) => console.error('Responder Redis synchronization failed:', error.message));
    }
    schedule({ neo4j: neo4jConfigured });
    return;
  }
  if (collectionName === 'alerts') {
    schedule({ redis: true });
    return;
  }
  if (collectionName === 'roads') {
    schedule({ neo4j: neo4jConfigured });
    return;
  }
  schedule({ redis: true, neo4j: neo4jConfigured });
}

export async function startMongoSynchronization({ initialRebuild = true } = {}) {
  for (const [collectionName, model] of Object.entries(models)) {
    const stream = model.watch([], { fullDocument: 'updateLookup' });
    stream.on('change', (change) => handleChange(collectionName, change));
    stream.on('error', (error) => console.error(`MongoDB ${collectionName} change stream error:`, error.message));
    streams.push(stream);
  }
  if (!neo4jConfigured) console.warn('MongoDB-to-Neo4j synchronization is disabled: configure NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD.');
  if (initialRebuild) schedule({ redis: true, neo4j: neo4jConfigured });
  console.info('MongoDB change-stream synchronization started.');
  return stopMongoSynchronization;
}

export async function stopMongoSynchronization() {
  clearTimeout(timer);
  await Promise.all(streams.map((stream) => stream.close().catch((error) => {
    console.error('Could not close MongoDB change stream:', error.message);
  })));
  streams = [];
}
