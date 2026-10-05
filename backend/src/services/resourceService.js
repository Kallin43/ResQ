import Facility from '../models/Facility.js';
import Resource from '../models/Resource.js';
import AppError from '../utils/AppError.js';
import { adjustOperationalCounter, initializeFacilityCounters, stockCounterKey } from './operationalStateService.js';
import { publishRealtimeEvent } from './realtimeEventService.js';

async function managerFacilityIds(user) {
  const facilities = await Facility.find({ 'contact.manager_id': user._id }).select('_id').lean();
  return facilities.map(({ _id }) => _id);
}

export async function listResources(filters, pagination, user) {
  const query = { ...filters };
  if (user.role === 'FACILITY_MANAGER') {
    const ids = await managerFacilityIds(user);
    if (query.facility_id && !ids.some((id) => id.equals(query.facility_id))) throw new AppError(404, 'Facility not found.');
    if (!query.facility_id) query.facility_id = { $in: ids };
  }
  const [data, total] = await Promise.all([
    Resource.find(query).sort({ category: 1, item: 1 }).skip(pagination.skip).limit(pagination.limit),
    Resource.countDocuments(query),
  ]);
  return { data, pagination: { page: pagination.page, limit: pagination.limit, total, pages: Math.ceil(total / pagination.limit) } };
}

export async function createResource(data, user) {
  if (user.role === 'FACILITY_MANAGER') {
    const facility = await Facility.findOne({ _id: data.facility_id, 'contact.manager_id': user._id });
    if (!facility) throw new AppError(404, 'Facility not found.');
  }
  if (data.reserved > data.quantity) throw new AppError(400, 'reserved cannot exceed quantity.');
  await initializeFacilityCounters(data.facility_id).catch((error) => {
    if (error.statusCode !== 503) throw error;
  });
  const resource = await Resource.create(data);
  await adjustOperationalCounter(stockCounterKey(resource.facility_id, resource.category), resource.quantity - resource.reserved, 0)
    .catch((error) => console.error('Failed to update Redis resource counter:', error.message));
  try {
    const facility = await Facility.findById(resource.facility_id).select('zone_code').lean();
    await publishRealtimeEvent('resource:updated', facility?.zone_code, resource);
  } catch (error) { console.error('Failed to publish resource creation event:', error.message); }
  return resource;
}

export async function updateResource(id, changes, user) {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found.');
  const before = { category: resource.category, available: resource.quantity - resource.reserved };
  if (user.role === 'FACILITY_MANAGER') {
    const facility = await Facility.findOne({ _id: resource.facility_id, 'contact.manager_id': user._id });
    if (!facility) throw new AppError(404, 'Resource not found.');
  }
  for (const key of ['category', 'item', 'quantity', 'unit', 'reserved']) {
    if (changes[key] !== undefined) resource.set(key, changes[key]);
  }
  if (resource.reserved > resource.quantity) throw new AppError(400, 'reserved cannot exceed quantity.');
  await initializeFacilityCounters(resource.facility_id).catch((error) => {
    if (error.statusCode !== 503) throw error;
  });
  await resource.save();
  await adjustOperationalCounter(stockCounterKey(resource.facility_id, before.category), -before.available, before.available)
    .catch((error) => console.error('Failed to update Redis resource counter:', error.message));
  await adjustOperationalCounter(stockCounterKey(resource.facility_id, resource.category), resource.quantity - resource.reserved, 0)
    .catch((error) => console.error('Failed to update Redis resource counter:', error.message));
  try {
    const facility = await Facility.findById(resource.facility_id).select('zone_code').lean();
    await publishRealtimeEvent('resource:updated', facility?.zone_code, resource);
  } catch (error) { console.error('Failed to publish resource update event:', error.message); }
  return resource;
}

// DELETE. Reserved stock is committed to allocations, so it must be released first.
export async function deleteResource(id, user) {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found.');
  if (user.role === 'FACILITY_MANAGER') {
    const facility = await Facility.findOne({ _id: resource.facility_id, 'contact.manager_id': user._id });
    if (!facility) throw new AppError(404, 'Resource not found.');
  }
  if (resource.reserved > 0) throw new AppError(409, 'Resource has reserved units; release them before deleting.');
  await Resource.deleteOne({ _id: resource._id });
  await adjustOperationalCounter(stockCounterKey(resource.facility_id, resource.category), -resource.quantity, resource.quantity)
    .catch((error) => console.error('Failed to update Redis resource counter:', error.message));
  try {
    const facility = await Facility.findById(resource.facility_id).select('zone_code').lean();
    await publishRealtimeEvent('resource:updated', facility?.zone_code, { _id: resource._id, deleted: true, facility_id: resource.facility_id });
  } catch (error) { console.error('Failed to publish resource deletion event:', error.message); }
  return { _id: resource._id, deleted: true };
}
