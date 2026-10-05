import Incident from '../models/Incident.js';
import Allocation from '../models/Allocation.js';
import AppError from '../utils/AppError.js';
import { acquireIncidentLock, cacheIncident, releaseIncidentLock } from './operationalStateService.js';
import { getRedisClient } from '../config/redis.js';
import { publishRealtimeEvent } from './realtimeEventService.js';

const INCIDENT_STATUSES = ['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'DUPLICATE', 'UNREACHABLE'];

export function classifySeverity({ type, people_affected = 0, needs = [] }) {
  const urgentNeeds = needs.map((need) => need.toUpperCase());
  if (people_affected >= 100 || urgentNeeds.some((need) => ['URGENT', 'EMERGENCY', 'EVACUATION'].includes(need))) return 'CRITICAL';
  if (['EARTHQUAKE', 'CYCLONE', 'STRUCTURAL'].includes(type) || people_affected >= 25) return 'HIGH';
  if (['FIRE', 'FLOOD', 'LANDSLIDE', 'MEDICAL'].includes(type) || people_affected >= 5) return 'MODERATE';
  return 'LOW';
}

export async function createIncident(data, user) {
  const incident = await Incident.create({ ...data, reporter_id: user._id, severity: classifySeverity(data), status: 'REPORTED' });
  await cacheIncident(incident).catch((error) => console.error('Failed to refresh Redis incident state:', error.message));
  await publishRealtimeEvent('incident:created', incident.zone_code, incident, { userIds: [user._id] })
    .catch((error) => console.error('Failed to publish incident creation event:', error.message));
  return incident;
}

function readableIncidentFilter(user) {
  if (user.role === 'CITIZEN') return { reporter_id: user._id };
  return {};
}

export async function listIncidents(filters, user) {
  const query = { ...readableIncidentFilter(user) };
  for (const key of ['status', 'severity', 'type', 'zone_code']) {
    if (filters[key] !== undefined) query[key] = filters[key];
  }
  if (user.role === 'VOLUNTEER') {
    const allocations = await Allocation.find({ responder_id: user._id }).select('incident_id').lean();
    query._id = { $in: allocations.map(({ incident_id }) => incident_id) };
  }
  const { skip, limit, page } = filters.pagination;
  const [data, total] = await Promise.all([
    Incident.find(query).sort({ reported_at: -1 }).skip(skip).limit(limit),
    Incident.countDocuments(query),
  ]);
  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getIncident(id, user) {
  const incident = await Incident.findById(id);
  if (!incident) throw new AppError(404, 'Incident not found.');
  if (user.role === 'CITIZEN' && !incident.reporter_id.equals(user._id)) throw new AppError(404, 'Incident not found.');
  if (user.role === 'VOLUNTEER') {
    const assigned = await Allocation.exists({ incident_id: incident._id, responder_id: user._id });
    if (!assigned) throw new AppError(404, 'Incident not found.');
  }
  return incident;
}

export async function updateIncidentStatus(id, status) {
  const lockToken = getRedisClient() ? await acquireIncidentLock(id) : null;
  if (getRedisClient() && !lockToken) throw new AppError(409, 'Incident is being updated; retry shortly.');
  try {
    const incident = await Incident.findById(id);
    if (!incident) throw new AppError(404, 'Incident not found.');
    incident.status = status;
    if (['RESOLVED', 'DUPLICATE', 'UNREACHABLE'].includes(status)) incident.closed_at = new Date();
    else incident.closed_at = null;
    await incident.save();
    await cacheIncident(incident).catch((error) => console.error('Failed to refresh Redis incident state:', error.message));
    await publishRealtimeEvent('incident:updated', incident.zone_code, incident, { userIds: [incident.reporter_id] })
      .catch((error) => console.error('Failed to publish incident update event:', error.message));
    return incident;
  } finally {
    if (lockToken) await releaseIncidentLock(id, lockToken).catch((error) => console.error('Failed to release incident lock:', error.message));
  }
}

export { INCIDENT_STATUSES };

const EDITABLE_INCIDENT_FIELDS = ['type', 'description', 'people_affected', 'needs', 'media', 'zone_code', 'location'];

// UPDATE (full field edit). Citizens may edit their own report only while it is still REPORTED;
// authorities/admins may correct any open report. Severity is re-derived from the new values.
export async function updateIncident(id, changes, user) {
  const incident = await Incident.findById(id);
  if (!incident) throw new AppError(404, 'Incident not found.');
  if (user.role === 'CITIZEN') {
    if (!incident.reporter_id.equals(user._id)) throw new AppError(404, 'Incident not found.');
    if (incident.status !== 'REPORTED') throw new AppError(409, 'Only reports that have not been verified can be edited.');
  }
  for (const key of EDITABLE_INCIDENT_FIELDS) {
    if (changes[key] !== undefined) incident.set(key, changes[key]);
  }
  incident.severity = classifySeverity(incident.toObject());
  await incident.save();
  await cacheIncident(incident).catch((error) => console.error('Failed to refresh Redis incident state:', error.message));
  await publishRealtimeEvent('incident:updated', incident.zone_code, incident, { userIds: [incident.reporter_id] })
    .catch((error) => console.error('Failed to publish incident update event:', error.message));
  return incident;
}

// DELETE. Incidents with active allocations cannot be removed; closed allocations are kept
// as history. The Redis live-queue entry and cached summary are removed with the record.
export async function deleteIncident(id, user) {
  const incident = await Incident.findById(id);
  if (!incident) throw new AppError(404, 'Incident not found.');
  if (user.role === 'CITIZEN' && (!incident.reporter_id.equals(user._id) || incident.status !== 'REPORTED')) {
    throw new AppError(403, 'Citizens can only withdraw their own unverified reports.');
  }
  const active = await Allocation.exists({ incident_id: incident._id, state: { $in: ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] } });
  if (active) throw new AppError(409, 'Cancel the active allocation before deleting this incident.');
  await Incident.deleteOne({ _id: incident._id });
  const client = getRedisClient();
  if (client) {
    await client.multi().zRem('incident:live', String(incident._id)).del(`incident:${incident._id}:summary`).exec()
      .catch((error) => console.error('Failed to remove Redis incident state:', error.message));
  }
  await publishRealtimeEvent('incident:updated', incident.zone_code, { _id: incident._id, deleted: true, zone_code: incident.zone_code })
    .catch((error) => console.error('Failed to publish incident deletion event:', error.message));
  return { _id: incident._id, deleted: true };
}

// READ with the incident_text_search index ($text + textScore sort).
export async function searchIncidents(text, { limit = 20 } = {}) {
  return Incident.find({ $text: { $search: text } }, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .lean();
}
