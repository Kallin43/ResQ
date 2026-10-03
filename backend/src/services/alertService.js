import Alert from '../models/Alert.js';
import AppError from '../utils/AppError.js';
import { getRedisClient } from '../config/redis.js';
import { publishRealtimeEvent } from './realtimeEventService.js';

const ACTIVE_ALERTS_KEY = 'alerts:active';

function alertSummary(alert) {
  const value = alert.toObject ? alert.toObject() : alert;
  return Object.fromEntries(['_id', 'zone_code', 'hazard_type', 'message', 'centre', 'radius_m', 'severity', 'expires_at', 'created_at']
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, value[key]]));
}

export async function cacheActiveAlert(alert) {
  const client = getRedisClient();
  if (!client) return false;
  const summary = alertSummary(alert);
  const id = String(summary._id);
  const expiresAt = new Date(summary.expires_at).getTime();
  const ttlSeconds = Math.ceil((expiresAt - Date.now()) / 1000);
  if (ttlSeconds <= 0) {
    await client.zRem(ACTIVE_ALERTS_KEY, id);
    await client.del(`alert:${id}:summary`);
    return false;
  }
  await client.multi()
    .zAdd(ACTIVE_ALERTS_KEY, [{ score: expiresAt, value: id }])
    .set(`alert:${id}:summary`, JSON.stringify(summary), { EX: ttlSeconds })
    .exec();
  return true;
}

export async function hydrateActiveAlerts() {
  const client = getRedisClient();
  if (!client) return 0;
  const now = Date.now();
  await client.zRemRangeByScore(ACTIVE_ALERTS_KEY, '-inf', now);
  const alerts = await Alert.find({ expires_at: { $gt: new Date(now) } }).sort({ expires_at: 1 }).lean();
  const currentIds = new Set(alerts.map(({ _id }) => String(_id)));
  const cachedIds = await client.zRange(ACTIVE_ALERTS_KEY, 0, -1);
  const staleIds = cachedIds.filter((id) => !currentIds.has(id));
  if (staleIds.length) await client.zRem(ACTIVE_ALERTS_KEY, staleIds);
  for (const alert of alerts) await cacheActiveAlert(alert);
  return alerts.length;
}

export async function pruneExpiredActiveAlerts() {
  const client = getRedisClient();
  if (!client) return 0;
  return client.zRemRangeByScore(ACTIVE_ALERTS_KEY, '-inf', Date.now());
}

export async function getActiveAlertsForZone(zoneCode, location) {
  const client = getRedisClient();
  if (!client || location?.type !== 'Point') return [];
  await pruneExpiredActiveAlerts();
  const ids = await client.zRange(ACTIVE_ALERTS_KEY, 0, -1);
  const alerts = await Promise.all(ids.map(async (id) => {
    const summary = await client.get(`alert:${id}:summary`);
    return summary ? JSON.parse(summary) : null;
  }));
  const now = Date.now();
  return alerts.filter((alert) => alert && alert.zone_code === zoneCode
    && new Date(alert.expires_at).getTime() > now
    && distanceMeters(location, alert.centre) <= Number(alert.radius_m));
}

function distanceMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const [firstLon, firstLat] = first.coordinates;
  const [secondLon, secondLat] = second.coordinates;
  const dLat = radians(secondLat - firstLat);
  const dLon = radians(secondLon - firstLon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(firstLat)) * Math.cos(radians(secondLat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function listAlerts(pagination, filters = {}, user) {
  await pruneExpiredActiveAlerts().catch(() => {});
  const query = { expires_at: { $gt: new Date() }, ...filters };
  const requestedCoordinates = filters.location;
  const profileLocation = user?.location;
  const location = requestedCoordinates ?? (profileLocation?.type === 'Point' ? profileLocation : null);
  delete query.location;
  if (!location) {
    const [data, total] = await Promise.all([
      Alert.find(query).sort({ created_at: -1 }).skip(pagination.skip).limit(pagination.limit),
      Alert.countDocuments(query),
    ]);
    return { data, pagination: { page: pagination.page, limit: pagination.limit, total, pages: Math.ceil(total / pagination.limit) } };
  }
  let records = await Alert.find(query).sort({ created_at: -1 }).lean();
  if (location) records = records.filter((alert) => distanceMeters(location, alert.centre) <= alert.radius_m);
  const total = records.length;
  const data = records.slice(pagination.skip, pagination.skip + pagination.limit);
  return { data, pagination: { page: pagination.page, limit: pagination.limit, total, pages: Math.ceil(total / pagination.limit) } };
}

export async function createAlert(data) {
  if (data.expires_at <= new Date()) throw new AppError(400, 'expires_at must be in the future.');
  const alert = await Alert.create(data);
  await cacheActiveAlert(alert).catch((error) => console.error('Failed to cache active alert in Redis:', error.message));
  await publishRealtimeEvent('alert:created', alert.zone_code, alert)
    .catch((error) => console.error('Failed to publish alert creation event:', error.message));
  return alert;
}

export async function expireAlert(id) {
  const alert = await Alert.findById(id);
  if (!alert) throw new AppError(404, 'Alert not found.');
  alert.expires_at = new Date();
  await alert.save();
  await cacheActiveAlert(alert).catch((error) => console.error('Failed to remove expired alert from Redis:', error.message));
  return alert;
}
