import Allocation from '../models/Allocation.js';
import Facility from '../models/Facility.js';
import Resource from '../models/Resource.js';
import { getRedisClient } from '../config/redis.js';
import AppError from '../utils/AppError.js';
import { adjustOperationalCounter, bedCounterKey } from './operationalStateService.js';
import { publishRealtimeEvent } from './realtimeEventService.js';

async function managerScope(user) {
  const facilities = await Facility.find({ 'contact.manager_id': user._id }).select('_id').lean();
  return { _id: { $in: facilities.map(({ _id }) => _id) } };
}

function combine(query, scope) {
  return Object.keys(scope).length ? { $and: [query, scope] } : query;
}

export async function listFacilities(filters, pagination, user) {
  const query = { ...filters };
  const scope = user.role === 'FACILITY_MANAGER' ? await managerScope(user) : {};
  const finalQuery = combine(query, scope);
  const [data, total] = await Promise.all([
    Facility.find(finalQuery).sort({ name: 1 }).skip(pagination.skip).limit(pagination.limit),
    Facility.countDocuments(finalQuery),
  ]);
  return { data, pagination: { page: pagination.page, limit: pagination.limit, total, pages: Math.ceil(total / pagination.limit) } };
}

export async function getFacility(id) {
  const facility = await Facility.findById(id);
  if (!facility) throw new AppError(404, 'Facility not found.');
  return facility;
}

export async function createFacility(data) {
  if (data.capacity_free > data.capacity_total) throw new AppError(400, 'capacity_free cannot exceed capacity_total.');
  const facility = await Facility.create(data);
  await adjustOperationalCounter(bedCounterKey(facility._id), 0, facility.capacity_free)
    .catch((error) => console.error('Failed to initialize Redis facility capacity:', error.message));
  await publishRealtimeEvent('facility:updated', facility.zone_code, facility)
    .catch((error) => console.error('Failed to publish facility creation event:', error.message));
  return facility;
}

export async function updateFacility(id, changes, user) {
  const facility = await Facility.findById(id);
  if (!facility) throw new AppError(404, 'Facility not found.');
  const previousCapacityFree = facility.capacity_free;
  if (user.role === 'FACILITY_MANAGER' && !facility.contact?.manager_id?.equals(user._id)) {
    throw new AppError(404, 'Facility not found.');
  }
  const allowed = user.role === 'FACILITY_MANAGER'
    ? ['capacity_free', 'operational']
    : ['name', 'kind', 'zone_code', 'location', 'address', 'contact', 'capacity_total', 'capacity_free', 'services', 'operational'];
  for (const key of allowed) {
    if (changes[key] === undefined) continue;
    if (key === 'address' || key === 'contact') {
      facility.set(key, { ...(facility[key]?.toObject?.() ?? facility[key] ?? {}), ...changes[key] });
    } else {
      facility.set(key, changes[key]);
    }
  }
  if (facility.capacity_free > facility.capacity_total) throw new AppError(400, 'capacity_free cannot exceed capacity_total.');
  await facility.save();
  await adjustOperationalCounter(bedCounterKey(facility._id), facility.capacity_free - previousCapacityFree, previousCapacityFree)
    .catch((error) => console.error('Failed to update Redis facility capacity:', error.message));
  await publishRealtimeEvent('facility:updated', facility.zone_code, facility)
    .catch((error) => console.error('Failed to publish facility update event:', error.message));
  return facility;
}

// DELETE. A facility with active allocations cannot be removed. Its inventory lines are
// deleted with it (cascade) and its Redis bed/stock counters are cleared.
export async function deleteFacility(id) {
  const facility = await Facility.findById(id);
  if (!facility) throw new AppError(404, 'Facility not found.');
  const active = await Allocation.exists({ facility_id: facility._id, state: { $in: ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] } });
  if (active) throw new AppError(409, 'This facility has active allocations and cannot be deleted.');
  const { deletedCount: resourcesDeleted } = await Resource.deleteMany({ facility_id: facility._id });
  await Facility.deleteOne({ _id: facility._id });
  const client = getRedisClient();
  if (client) {
    const keys = await client.keys(`facility:${facility._id}:*`);
    if (keys.length) await client.del(keys);
  }
  await publishRealtimeEvent('facility:updated', facility.zone_code, { _id: facility._id, deleted: true })
    .catch((error) => console.error('Failed to publish facility deletion event:', error.message));
  return { _id: facility._id, deleted: true, resources_deleted: resourcesDeleted };
}

// Geospatial READ using the location 2dsphere index ($near sorts nearest-first).
export async function findNearbyFacilities({ longitude, latitude, maxDistanceM = 5000, kind, limit = 10 }) {
  const query = {
    operational: true,
    location: { $near: { $geometry: { type: 'Point', coordinates: [longitude, latitude] }, $maxDistance: maxDistanceM } },
  };
  if (kind) query.kind = kind;
  return Facility.find(query).limit(limit).lean();
}

// Text search over facility name/services using facility_text_search.
export async function searchFacilities(text, { limit = 20 } = {}) {
  return Facility.find({ $text: { $search: text } }, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } }).limit(limit).lean();
}
