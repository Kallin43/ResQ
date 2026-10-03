import Allocation from '../models/Allocation.js';
import Incident from '../models/Incident.js';
import Road from '../models/Road.js';
import { getNeo4jDriver, neo4jDatabaseName } from '../config/neo4j.js';
import { publishRealtimeEvent } from './realtimeEventService.js';
import { roadIdFor, zonesFromRoadId } from '../utils/roadId.js';
import AppError from '../utils/AppError.js';

const ROAD_STATUSES = ['OPEN', 'FLOODED', 'BLOCKED'];
const ACTIVE_ALLOCATION_STATES = ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];

function roadView(road) {
  return {
    road_id: road.road_id,
    from_zone: road.from_zone,
    to_zone: road.to_zone,
    status: road.status,
    travel_minutes: road.travel_minutes,
  };
}

function affectedByRoad(allocation, road) {
  const path = allocation.route?.path_zone_codes;
  if (!Array.isArray(path)) return false;
  for (let index = 1; index < path.length; index += 1) {
    if ((path[index - 1] === road.from_zone && path[index] === road.to_zone)
      || (path[index - 1] === road.to_zone && path[index] === road.from_zone)) return true;
  }
  return false;
}

async function projectRoad(road) {
  let driver;
  try { driver = await getNeo4jDriver(); }
  catch (error) {
    console.error('Neo4j road projection is pending:', error.message);
    return false;
  }
  const session = driver.session({ database: neo4jDatabaseName() });
  try {
    const result = await session.executeWrite((transaction) => transaction.run(
      `MERGE (first:Zone {id: $fromZone})
       ON CREATE SET first.code = $fromZone, first.dataset = 'resq-district'
       MERGE (second:Zone {id: $toZone})
       ON CREATE SET second.code = $toZone, second.dataset = 'resq-district'
       MERGE (first)-[forward:ROAD_TO {road_id: $roadId}]->(second)
       SET forward.status = $status, forward.travel_minutes = $travelMinutes
       MERGE (second)-[reverse:ROAD_TO {road_id: $roadId}]->(first)
       SET reverse.status = $status, reverse.travel_minutes = $travelMinutes
       RETURN count(forward) + count(reverse) AS count`,
      {
        fromZone: road.from_zone, toZone: road.to_zone, roadId: road.road_id,
        status: road.status, travelMinutes: road.travel_minutes,
      },
    ));
    return (result.records[0]?.get('count')?.toNumber?.() ?? 0) === 2;
  } catch (error) {
    console.error('Neo4j road projection is pending:', error.message);
    return false;
  } finally { await session.close(); }
}

async function removeRoadProjection(road) {
  try {
    const driver = await getNeo4jDriver();
    const session = driver.session({ database: neo4jDatabaseName() });
    try {
      await session.executeWrite((transaction) => transaction.run(
        `MATCH ()-[road:ROAD_TO {road_id: $roadId}]->() DELETE road
         WITH 1 AS ignored
         UNWIND $zones AS zoneId
         MATCH (zone:Zone {id: zoneId})
         WHERE NOT (zone)--()
         DELETE zone`,
        { roadId: road.road_id, zones: [road.from_zone, road.to_zone] },
      ));
      return true;
    } finally { await session.close(); }
  } catch (error) {
    console.error('Neo4j road deletion projection is pending:', error.message);
    return false;
  }
}

async function markAllocationsForReview(road) {
  const possible = await Allocation.find({
    state: { $in: ACTIVE_ALLOCATION_STATES },
    'route.path_zone_codes': { $all: [road.from_zone, road.to_zone] },
  });
  const affectedAllocations = [];
  for (const allocation of possible.filter((candidate) => affectedByRoad(candidate, road))) {
    const updated = await Allocation.findOneAndUpdate(
      { _id: allocation._id, state: { $in: ACTIVE_ALLOCATION_STATES } },
      { $set: { review_required: true, review_reason: `Route uses ${road.from_zone} ↔ ${road.to_zone}, now ${road.status}.` } },
      { new: true },
    );
    if (!updated) continue;
    affectedAllocations.push(String(updated._id));
    try {
      const incident = await Incident.findById(updated.incident_id).select('zone_code').lean();
      await publishRealtimeEvent('allocation:updated', incident?.zone_code, updated, {
        userIds: updated.responder_id ? [updated.responder_id] : [],
      });
    } catch (error) {
      console.error(`Failed to notify responder for allocation ${updated._id}:`, error.message);
    }
  }
  return affectedAllocations;
}

export async function listRoads() {
  const roads = await Road.find({}).sort({ from_zone: 1, to_zone: 1 }).lean();
  return roads.map(roadView);
}

export async function getRoad(roadId) {
  const road = await Road.findOne({ road_id: roadId }).lean();
  if (!road) throw new AppError(404, 'Road segment not found.');
  return roadView(road);
}

export async function createRoad({ from_zone, to_zone, status = 'OPEN', travel_minutes }) {
  if (from_zone === to_zone) throw new AppError(400, 'from_zone and to_zone must identify different zones.');
  if (!ROAD_STATUSES.includes(status)) throw new AppError(400, `status must be one of: ${ROAD_STATUSES.join(', ')}.`);
  const [fromZone, toZone] = [from_zone, to_zone].sort();
  const road = await Road.create({
    road_id: roadIdFor(fromZone, toZone), from_zone: fromZone, to_zone: toZone, status, travel_minutes,
  });
  const projected = await projectRoad(road);
  return { ...roadView(road), syncPending: !projected };
}

export async function updateRoadStatus(roadId, status) {
  if (!ROAD_STATUSES.includes(status)) throw new AppError(400, `status must be one of: ${ROAD_STATUSES.join(', ')}.`);
  const road = await Road.findOneAndUpdate({ road_id: roadId }, { $set: { status } }, { new: true, runValidators: true });
  if (!road) throw new AppError(404, 'Road segment not found.');
  const projected = await projectRoad(road);
  const affectedAllocations = status === 'OPEN' ? [] : await markAllocationsForReview(road);
  return { ...roadView(road), updatedRelationships: projected ? 2 : 0, syncPending: !projected, affectedAllocations };
}

export async function updateRoad(roadId, changes) {
  const road = await Road.findOneAndUpdate({ road_id: roadId }, { $set: changes }, { new: true, runValidators: true });
  if (!road) throw new AppError(404, 'Road segment not found.');
  const projected = await projectRoad(road);
  const affectedAllocations = changes.status && changes.status !== 'OPEN' ? await markAllocationsForReview(road) : [];
  return { ...roadView(road), updatedRelationships: projected ? 2 : 0, syncPending: !projected, affectedAllocations };
}

export async function deleteRoad(roadId) {
  const zones = zonesFromRoadId(roadId);
  if (!zones) throw new AppError(400, 'roadId is invalid.');
  const road = await Road.findOneAndDelete({ road_id: roadId, from_zone: zones[0], to_zone: zones[1] });
  if (!road) throw new AppError(404, 'Road segment not found.');
  const removedFromGraph = await removeRoadProjection(road);
  const affectedAllocations = await markAllocationsForReview({ ...road.toObject(), status: 'BLOCKED' });
  return { ...roadView(road), removedFromGraph, syncPending: !removedFromGraph, affectedAllocations };
}
