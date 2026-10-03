import { randomUUID } from 'node:crypto';
import Facility from '../models/Facility.js';
import Incident from '../models/Incident.js';
import Resource from '../models/Resource.js';
import { getRedisClient } from '../config/redis.js';
import AppError from '../utils/AppError.js';

export const PRESENCE_TTL_SECONDS = 90;
export const INCIDENT_SUMMARY_TTL_SECONDS = 300;
const OPEN_INCIDENT_STATUSES = new Set(['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS']);

function requireRedis() {
  const client = getRedisClient();
  if (!client) throw new AppError(503, 'Redis operational state is unavailable.');
  return client;
}

export function bedCounterKey(facilityId) {
  return `facility:${facilityId}:beds`;
}

export function stockCounterKey(facilityId, category) {
  return `facility:${facilityId}:stock:${encodeURIComponent(category)}`;
}

export async function initializeFacilityCounters(facilityId) {
  const client = requireRedis();
  const facility = await Facility.findById(facilityId).lean();
  if (!facility) throw new AppError(404, 'Facility not found.');
  await client.set(bedCounterKey(facilityId), String(facility.capacity_free ?? 0), { NX: true });

  const categories = await Resource.aggregate([
    { $match: { facility_id: facility._id } },
    { $group: { _id: '$category', available: { $sum: { $subtract: ['$quantity', '$reserved'] } } } },
  ]);
  for (const { _id: category, available } of categories) {
    await client.set(stockCounterKey(facilityId, category), String(Math.max(0, available)), { NX: true });
  }
  return facility;
}

// Redis serializes each DECR/INCR command; compensation ensures a rejected request
// never leaves a negative counter behind.
export async function reserveCounterUsing(client, key, units = 1) {
  if (!Number.isInteger(units) || units < 1) throw new AppError(400, 'Reservation units must be a positive integer.');
  let reserved = 0;
  for (; reserved < units; reserved += 1) {
    const remaining = await client.decr(key);
    if (remaining < 0) {
      await client.incr(key);
      if (reserved) await client.incrBy(key, reserved);
      return false;
    }
  }
  return true;
}

export async function reserveCounter(key, units = 1) {
  return reserveCounterUsing(requireRedis(), key, units);
}

export async function reserveWithPersistenceUsing(client, reservations, persist) {
  const held = [];
  try {
    for (const { key, units = 1, rejectionMessage } of reservations) {
      if (!(await reserveCounterUsing(client, key, units))) {
        throw new AppError(409, rejectionMessage ?? 'Operational capacity is unavailable.');
      }
      held.push({ key, units });
    }
    return await persist();
  } catch (error) {
    for (const { key, units } of held.reverse()) {
      try { await client.incrBy(key, units); }
      catch (restoreError) { console.error('Failed to restore Redis reservation counter:', restoreError.message); }
    }
    throw error;
  }
}

export async function reserveWithPersistence(reservations, persist) {
  return reserveWithPersistenceUsing(requireRedis(), reservations, persist);
}

export async function restoreCounter(key, units = 1) {
  if (units > 0) await requireRedis().incrBy(key, units);
}

export async function adjustOperationalCounter(key, delta, initialValue = 0) {
  const client = getRedisClient();
  if (!client) return;
  await client.set(key, String(initialValue), { NX: true });
  if (delta) await client.incrBy(key, delta);
}

export async function cacheIncident(incident) {
  const client = getRedisClient();
  if (!client) return;
  const value = incident.toObject ? incident.toObject() : incident;
  const id = String(value._id);
  if (OPEN_INCIDENT_STATUSES.has(value.status)) {
    await client.zAdd('incident:live', [{ score: new Date(value.reported_at).getTime(), value: id }]);
  } else {
    await client.zRem('incident:live', id);
  }
  const summary = {
    _id: id, type: value.type, severity: value.severity, status: value.status,
    people_affected: value.people_affected, location: value.location, zone_code: value.zone_code,
    needs: value.needs, reported_at: value.reported_at,
  };
  await client.set(`incident:${id}:summary`, JSON.stringify(summary), { EX: INCIDENT_SUMMARY_TTL_SECONDS });
}

export async function hydrateLiveIncidentQueue() {
  const client = getRedisClient();
  if (!client) return 0;
  const incidents = await Incident.find({ status: { $in: [...OPEN_INCIDENT_STATUSES] } })
    .sort({ reported_at: -1 }).lean();
  const activeIds = new Set(incidents.map(({ _id }) => String(_id)));
  const cachedIds = await client.zRange('incident:live', 0, -1);
  const staleIds = cachedIds.filter((id) => !activeIds.has(id));
  if (staleIds.length) await client.zRem('incident:live', staleIds);
  for (const incident of incidents) {
    const id = String(incident._id);
    const summary = {
      _id: id, type: incident.type, severity: incident.severity, status: incident.status,
      people_affected: incident.people_affected, location: incident.location, zone_code: incident.zone_code,
      needs: incident.needs, reported_at: incident.reported_at,
    };
    await client.zAdd('incident:live', [{ score: new Date(incident.reported_at).getTime(), value: id }]);
    await client.set(`incident:${id}:summary`, JSON.stringify(summary), { EX: INCIDENT_SUMMARY_TTL_SECONDS });
  }
  return incidents.length;
}

export async function getLiveIncidents({ offset = 0, count = 50 } = {}) {
  const client = requireRedis();
  const ids = await client.zRange('incident:live', offset, offset + count - 1, { REV: true });
  return Promise.all(ids.map(async (id) => {
    const summary = await client.get(`incident:${id}:summary`);
    return summary ? JSON.parse(summary) : refreshIncidentSummary(id);
  })).then((items) => items.filter(Boolean));
}

export async function refreshIncidentSummary(incidentId) {
  const client = requireRedis();
  const cached = await client.get(`incident:${incidentId}:summary`);
  if (cached) return JSON.parse(cached);
  const incident = await Incident.findById(incidentId).lean();
  if (!incident) return null;
  await cacheIncident(incident);
  const refreshed = await client.get(`incident:${incidentId}:summary`);
  return refreshed ? JSON.parse(refreshed) : null;
}

export async function setResponderPresence(responderId, { longitude, latitude, available = true }, ttl = PRESENCE_TTL_SECONDS) {
  const client = requireRedis();
  if (typeof available !== 'boolean') throw new AppError(400, 'Responder availability must be a boolean.');
  const key = `responder:${responderId}:presence`;
  if (!available) {
    await client.del(key);
    await client.zRem('geo:responders', String(responderId));
    return null;
  }
  if (![longitude, latitude].every(Number.isFinite) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new AppError(400, 'Responder location must contain valid longitude and latitude.');
  }
  const presence = { responder_id: String(responderId), available: true, updated_at: new Date().toISOString() };
  await client.set(key, JSON.stringify(presence), { EX: ttl });
  await client.geoAdd('geo:responders', { longitude, latitude, member: String(responderId) });
  return presence;
}

export async function findNearbyResponders({ longitude, latitude, radiusKm = 10 }) {
  const client = requireRedis();
  const responders = await client.geoSearchWith(
    'geo:responders', { longitude, latitude }, { radius: radiusKm, unit: 'km' },
    ['WITHDIST', 'WITHCOORD'], { SORT: 'ASC' },
  );
  const live = await Promise.all(responders.map(async (responder) => {
    const presence = await client.get(`responder:${responder.member}:presence`);
    if (!presence) {
      await client.zRem('geo:responders', responder.member);
      return null;
    }
    return { ...JSON.parse(presence), distance_km: Number(responder.distance), coordinates: responder.coordinates };
  }));
  return live.filter(Boolean);
}

export async function acquireIncidentLock(incidentId, ttlMs = 5000) {
  const client = requireRedis();
  const token = randomUUID();
  const result = await client.set(`lock:incident:${incidentId}`, token, { NX: true, PX: ttlMs });
  return result === 'OK' ? token : null;
}

export async function releaseIncidentLock(incidentId, token) {
  const client = requireRedis();
  return client.eval(
    'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
    { keys: [`lock:incident:${incidentId}`], arguments: [token] },
  );
}
