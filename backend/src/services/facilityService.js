import Facility from '../models/Facility.js';
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
