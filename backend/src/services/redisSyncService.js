import Facility from '../models/Facility.js';
import Incident from '../models/Incident.js';
import User from '../models/User.js';
import { getRedisClient } from '../config/redis.js';
import { setResponderPresence, hydrateLiveIncidentQueue, initializeFacilityCounters } from './operationalStateService.js';
import { hydrateActiveAlerts } from './alertService.js';
import AppError from '../utils/AppError.js';

async function deleteMatchingKeys(client, pattern) {
  let batch = [];
  let deleted = 0;
  for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
    batch.push(key);
    if (batch.length >= 500) {
      deleted += await client.del(batch);
      batch = [];
    }
  }
  if (batch.length) deleted += await client.del(batch);
  return deleted;
}

export async function rebuildRedisFromMongo({ preservePresence = false } = {}) {
  const client = getRedisClient();
  if (!client) throw new AppError(503, 'Redis is required to rebuild derived state.');

  const patterns = [
    'incident:*:summary',
    'facility:*:beds',
    'facility:*:stock:*',
    'alert:*:summary',
  ];
  await Promise.all(patterns.map((pattern) => deleteMatchingKeys(client, pattern)));
  await client.del(['incident:live', 'alerts:active']);
  if (!preservePresence) {
    await deleteMatchingKeys(client, 'responder:*:presence');
    await client.del('geo:responders');
  }

  const [incidentCount, alertCount] = await Promise.all([
    hydrateLiveIncidentQueue(),
    hydrateActiveAlerts(),
  ]);
  const facilities = await Facility.find({}).select('_id').lean();
  await Promise.all(facilities.map(({ _id }) => initializeFacilityCounters(_id)));

  let responderCount = 0;
  if (!preservePresence) {
    const responders = await User.find({ role: { $in: ['VOLUNTEER', 'RESCUE_LEAD'] }, available: true }).lean();
    for (const responder of responders) {
      const coordinates = responder.location?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length !== 2) continue;
      await setResponderPresence(responder._id, {
        longitude: Number(coordinates[0]),
        latitude: Number(coordinates[1]),
        available: true,
      });
      responderCount += 1;
    }
  }

  return { incidents: incidentCount, facilities: facilities.length, alerts: alertCount, responders: responderCount };
}

export async function syncResponderFromMongo(responderId) {
  const client = getRedisClient();
  if (!client) return false;
  const user = await User.findById(responderId).lean();
  if (!user || !['VOLUNTEER', 'RESCUE_LEAD'].includes(user.role) || !user.available || !user.location?.coordinates) {
    await client.del(`responder:${responderId}:presence`);
    await client.zRem('geo:responders', String(responderId));
    return false;
  }
  await setResponderPresence(responderId, {
    longitude: Number(user.location.coordinates[0]),
    latitude: Number(user.location.coordinates[1]),
    available: true,
  });
  return true;
}
