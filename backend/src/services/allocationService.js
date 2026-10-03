import Allocation from '../models/Allocation.js';
import Facility from '../models/Facility.js';
import Resource from '../models/Resource.js';
import { getRedisClient } from '../config/redis.js';
import Incident from '../models/Incident.js';
import User from '../models/User.js';
import {
  bedCounterKey,
  acquireIncidentLock,
  initializeFacilityCounters,
  releaseIncidentLock,
  reserveWithPersistence,
  stockCounterKey,
} from './operationalStateService.js';
import { publishRealtimeEvent } from './realtimeEventService.js';
import AppError from '../utils/AppError.js';

export async function listAllocations(pagination, user) {
  const query = user.role === 'VOLUNTEER'
    ? { responder_id: user._id }
    : user.role === 'RESCUE_LEAD'
      ? (user.team_id ? { team_id: user.team_id } : { _id: { $exists: false } })
      : {};
  const [data, total] = await Promise.all([
    Allocation.find(query).sort({ created_at: -1 }).skip(pagination.skip).limit(pagination.limit),
    Allocation.countDocuments(query),
  ]);
  return { data, pagination: { page: pagination.page, limit: pagination.limit, total, pages: Math.ceil(total / pagination.limit) } };
}

export async function getAllocation(id, user) {
  const query = { _id: id };
  if (user.role === 'VOLUNTEER') query.responder_id = user._id;
  if (user.role === 'RESCUE_LEAD') {
    if (!user.team_id) throw new AppError(404, 'Allocation not found.');
    query.team_id = user.team_id;
  }
  const allocation = await Allocation.findOne(query);
  if (!allocation) throw new AppError(404, 'Allocation not found.');
  return allocation;
}

export async function createAllocation(data, user) {
  if (!['AUTHORITY', 'ADMIN'].includes(user.role)) throw new AppError(403, 'Only an authority may confirm an allocation.');
  if (!getRedisClient()) throw new AppError(503, 'Redis is required to confirm and reserve an allocation.');
  const lockToken = await acquireIncidentLock(data.incident_id, 30000);
  if (!lockToken) throw new AppError(409, 'This incident is being allocated; retry shortly.');
  try {
    return await createAllocationWithIncidentLock(data, user);
  } finally {
    await releaseIncidentLock(data.incident_id, lockToken)
      .catch((error) => console.error('Failed to release allocation incident lock:', error.message));
  }
}

async function createAllocationWithIncidentLock(data, user) {
  if (!['AUTHORITY', 'ADMIN'].includes(user.role)) throw new AppError(403, 'Only an authority may confirm an allocation.');
  if (data.state && data.state !== 'PROPOSED') throw new AppError(400, 'Allocations must start in PROPOSED state.');
  if (!data.responder_id || !data.facility_id) throw new AppError(400, 'A confirmed allocation requires a responder and facility.');
  data.state = 'PROPOSED';
  const incidentRecord = await Incident.findById(data.incident_id);
  if (!incidentRecord) throw new AppError(404, 'Incident not found.');
  if (['RESOLVED', 'DUPLICATE', 'UNREACHABLE'].includes(incidentRecord.status)) throw new AppError(409, 'A closed incident cannot receive an allocation.');
  const responder = await User.findById(data.responder_id);
  if (!responder || !['VOLUNTEER', 'RESCUE_LEAD'].includes(responder.role)) throw new AppError(400, 'The selected responder is not eligible.');
  if (responder.available === false) throw new AppError(409, 'The selected responder is not available.');
  if (responder.team_id && data.team_id && !responder.team_id.equals(data.team_id)) throw new AppError(400, 'The selected responder does not belong to the selected team.');
  data.team_id ??= responder.team_id ?? undefined;
  const facilityRecord = await Facility.findById(data.facility_id);
  if (!facilityRecord || !facilityRecord.operational) throw new AppError(409, 'The selected facility is not operational.');
  const existingActive = await Allocation.exists({
    $or: [{ incident_id: data.incident_id }, { responder_id: data.responder_id }],
    state: { $in: ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] },
  });
  if (existingActive) throw new AppError(409, 'The incident or responder already has an active allocation.');
  const redis = getRedisClient();
  const reservationPlan = [];
  const mongoChanges = { beds: false, resources: [] };
  let updatedFacility;
  const updatedResourceDocs = [];

  if ((data.facility_id || data.resources?.length) && !redis) {
    throw new AppError(503, 'Redis is required to reserve facility capacity or resources.');
  }

  let facility = null;
  if (data.facility_id) {
    facility = await initializeFacilityCounters(data.facility_id);
    reservationPlan.push({ key: bedCounterKey(data.facility_id), units: 1, rejectionMessage: 'Facility has no available capacity.' });
  }

  const resourceDocs = [];
  if (data.resources?.length) {
    for (const item of data.resources) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new AppError(400, 'Resource allocation quantity must be a positive integer.');
      }
      const resource = await Resource.findById(item.resource_id);
      if (!resource) throw new AppError(404, 'Resource not found.');
      if (data.facility_id && !resource.facility_id.equals(data.facility_id)) {
        throw new AppError(400, 'Allocated resources must belong to the selected facility.');
      }
      await initializeFacilityCounters(resource.facility_id);
      reservationPlan.push({
        key: stockCounterKey(resource.facility_id, resource.category),
        units: item.quantity,
        rejectionMessage: `Insufficient ${resource.category} stock at the selected facility.`,
      });
      resourceDocs.push({ resource, quantity: item.quantity });
    }
  }

  const persist = async () => {
    let allocation;
    try {
      if (facility) {
        updatedFacility = await Facility.findOneAndUpdate(
          { _id: facility._id, capacity_free: { $gt: 0 } },
          { $inc: { capacity_free: -1 } },
          { new: true, runValidators: true },
        );
        if (!updatedFacility) throw new AppError(409, 'Facility has no available capacity in MongoDB.');
        mongoChanges.beds = true;
      }

      for (const { resource, quantity } of resourceDocs) {
        const updated = await Resource.findOneAndUpdate(
          { _id: resource._id, $expr: { $gte: [{ $subtract: ['$quantity', '$reserved'] }, quantity] } },
          { $inc: { reserved: quantity } },
          { new: true, runValidators: true },
        );
        if (!updated) throw new AppError(409, `Insufficient ${resource.category} stock in MongoDB.`);
        mongoChanges.resources.push({ id: resource._id, quantity });
        updatedResourceDocs.push(updated);
      }

      allocation = new Allocation({ ...data, authorised_by: user._id, state: 'PROPOSED' });
      allocation.timeline.push({ state: 'PROPOSED', at: new Date(), by: user._id });
      await allocation.save();
      incidentRecord.status = 'ASSIGNED';
      await incidentRecord.save();
      await publishRealtimeEvent('incident:updated', incidentRecord.zone_code, incidentRecord)
        .catch((error) => console.error('Failed to publish incident assignment event:', error.message));
      await publishRealtimeEvent('allocation:created', incidentRecord.zone_code, allocation, { userIds: [allocation.responder_id] })
        .catch((error) => console.error('Failed to publish allocation creation event:', error.message));
      if (updatedFacility) {
        await publishRealtimeEvent('facility:updated', updatedFacility.zone_code, updatedFacility)
          .catch((error) => console.error('Failed to publish reserved facility capacity event:', error.message));
      }
      for (const resource of updatedResourceDocs) {
        try {
          const resourceFacility = await Facility.findById(resource.facility_id).select('zone_code').lean();
          await publishRealtimeEvent('resource:updated', resourceFacility?.zone_code, resource);
        } catch (error) { console.error('Failed to publish reserved resource event:', error.message); }
      }
      return allocation;
    } catch (error) {
      if (allocation?._id) {
        try { await Allocation.deleteOne({ _id: allocation._id }); }
        catch (rollbackError) { console.error('Failed to remove partially persisted allocation:', rollbackError.message); }
      }
      if (mongoChanges.beds) {
        try { await Facility.updateOne({ _id: data.facility_id }, { $inc: { capacity_free: 1 } }); }
        catch (rollbackError) { console.error('Failed to restore MongoDB facility capacity:', rollbackError.message); }
      }
      for (const { id, quantity } of mongoChanges.resources.reverse()) {
        try { await Resource.updateOne({ _id: id, reserved: { $gte: quantity } }, { $inc: { reserved: -quantity } }); }
        catch (rollbackError) { console.error('Failed to restore MongoDB resource quantity:', rollbackError.message); }
      }
      throw error;
    }
  };
  return reservationPlan.length ? reserveWithPersistence(reservationPlan, persist) : persist();
}

export async function updateAllocation(id, changes, user) {
  const allocation = await Allocation.findById(id);
  if (!allocation) throw new AppError(404, 'Allocation not found.');
  if (user.role === 'VOLUNTEER' && !allocation.responder_id?.equals(user._id)) throw new AppError(404, 'Allocation not found.');
  if (user.role === 'RESCUE_LEAD' && (!user.team_id || !allocation.team_id?.equals(user.team_id) || !allocation.responder_id?.equals(user._id))) throw new AppError(404, 'Allocation not found.');
  if (user.role === 'VOLUNTEER' && (changes.eta_minutes !== undefined || changes.route !== undefined)) {
    throw new AppError(403, 'Responders may only update allocation state.');
  }
  let updated;
  if (changes.state !== undefined) {
    const transitions = {
      VOLUNTEER: { PROPOSED: ['ACCEPTED'], ACCEPTED: ['EN_ROUTE'], EN_ROUTE: ['ON_SCENE'], ON_SCENE: ['COMPLETED'] },
      RESCUE_LEAD: { PROPOSED: ['ACCEPTED'], ACCEPTED: ['EN_ROUTE'], EN_ROUTE: ['ON_SCENE'], ON_SCENE: ['COMPLETED'] },
      AUTHORITY: { PROPOSED: ['CANCELLED'], ACCEPTED: ['CANCELLED'], EN_ROUTE: ['CANCELLED'], ON_SCENE: ['CANCELLED'] },
      ADMIN: { PROPOSED: ['CANCELLED'], ACCEPTED: ['CANCELLED'], EN_ROUTE: ['CANCELLED'], ON_SCENE: ['CANCELLED'] },
    };
    if (!transitions[user.role]?.[allocation.state]?.includes(changes.state)) {
      throw new AppError(400, `Invalid allocation transition from ${allocation.state} to ${changes.state} for ${user.role}.`);
    }
    const at = new Date();
    updated = await Allocation.findOneAndUpdate(
      { _id: allocation._id, state: allocation.state },
      { $set: { state: changes.state }, $push: { timeline: { state: changes.state, at, by: user._id } } },
      { new: true, runValidators: true },
    );
    if (!updated) throw new AppError(409, 'Allocation state changed concurrently. Reload and retry.');
    if (changes.state === 'CANCELLED') {
      try {
        const redis = getRedisClient();
        if (updated.facility_id) {
          const facility = await Facility.findById(updated.facility_id);
          if (facility) {
            if (redis) await initializeFacilityCounters(updated.facility_id);
            if (redis) await redis.incr(bedCounterKey(updated.facility_id));
            await Facility.updateOne({ _id: facility._id }, { $inc: { capacity_free: 1 } });
          }
        }
        for (const item of updated.resources) {
          const resource = await Resource.findById(item.resource_id);
          if (!resource) continue;
          if (redis) await initializeFacilityCounters(resource.facility_id);
          if (redis) await redis.incrBy(stockCounterKey(resource.facility_id, resource.category), item.quantity);
          await Resource.updateOne({ _id: resource._id, reserved: { $gte: item.quantity } }, { $inc: { reserved: -item.quantity } });
        }
      } catch (error) {
        console.error('Failed to release cancelled allocation reservations:', error.message);
      }
    }
  } else {
    const update = {};
    if (changes.eta_minutes !== undefined) update.eta_minutes = changes.eta_minutes;
    if (changes.route !== undefined) update.route = changes.route;
    updated = await Allocation.findByIdAndUpdate(allocation._id, { $set: update }, { new: true, runValidators: true });
  }
  try {
    const incident = await Incident.findById(updated.incident_id);
    if (changes.state === 'EN_ROUTE' && incident?.status === 'ASSIGNED') incident.status = 'IN_PROGRESS';
    if (changes.state === 'COMPLETED') {
      const active = await Allocation.exists({ incident_id: updated.incident_id, _id: { $ne: updated._id }, state: { $in: ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] } });
      if (!active && incident) { incident.status = 'RESOLVED'; incident.closed_at = new Date(); }
    }
    if (changes.state === 'CANCELLED') {
      const active = await Allocation.exists({ incident_id: updated.incident_id, _id: { $ne: updated._id }, state: { $in: ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] } });
      if (!active && incident) incident.status = 'REPORTED';
    }
    if (incident && changes.state !== undefined) {
      await incident.save();
      await publishRealtimeEvent('incident:updated', incident.zone_code, incident);
    }
    await publishRealtimeEvent('allocation:updated', incident?.zone_code, updated, { userIds: [updated.responder_id] });
    if (changes.state !== undefined) {
      await publishRealtimeEvent('responder:status', incident?.zone_code, {
        responder_id: updated.responder_id,
        allocation_id: updated._id,
        status: changes.state,
        updated_at: new Date(),
      }, { userIds: [updated.responder_id] });
    }
  } catch (error) { console.error('Failed to publish allocation update event:', error.message); }
  return updated;
}
