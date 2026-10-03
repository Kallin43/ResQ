import { getNeo4jDriver, neo4jDatabaseName } from '../config/neo4j.js';
import Incident from '../models/Incident.js';
import AppError from '../utils/AppError.js';

const REACHABILITY_QUERY = `
MATCH (incident:Incident {id: $incidentId})-[:LOCATED_IN]->(origin:Zone)
MATCH path = (origin)-[roads:ROAD_TO*0..4]->(zone:Zone)
WHERE all(road IN roads WHERE road.status = 'OPEN')
WITH incident, zone, min(reduce(total = 0, road IN roads | total + coalesce(road.travel_minutes, 0))) AS travelTime
MATCH (zone)-[:CONTAINS]->(facility:Facility)
WHERE facility.operational = true
OPTIONAL MATCH (facility)-[:STOCKS]->(resource:Resource)
WITH incident, zone, facility, travelTime,
     collect(CASE WHEN resource IS NULL THEN null ELSE {
       category: resource.category,
       item: resource.item,
       quantity: resource.quantity - coalesce(resource.reserved, 0),
       unit: resource.unit
     } END) AS stock
RETURN incident.needs AS needs,
       facility.id AS facilityId,
       facility.name AS facilityName,
       facility.capacity_free AS capacityFree,
       zone.code AS zone,
       travelTime,
       stock
`;

const RESPONDER_REACHABILITY_QUERY = `
MATCH (incident:Incident {id: $incidentId})-[:LOCATED_IN]->(origin:Zone)
MATCH path = (origin)-[roads:ROAD_TO*0..4]->(zone:Zone)
WHERE all(road IN roads WHERE road.status = 'OPEN')
WITH zone, min(reduce(total = 0, road IN roads | total + coalesce(road.travel_minutes, 0))) AS travelTime
MATCH (responder:Responder)-[:BASED_AT]->(zone)
WHERE responder.available = true
  AND NOT (responder)-[:ASSIGNED_TO]->(:Incident)
RETURN responder.id AS responderId, responder.role AS role,
       responder.team_id AS teamId, zone.code AS zone, min(travelTime) AS travelTime
`;

const NEED_ALIASES = {
  MEDICAL: ['MEDICAL', 'MEDICINE'],
  MEDICINE: ['MEDICAL', 'MEDICINE'],
  RESCUE: ['RESCUE', 'RESCUE_EQUIPMENT'],
  RESCUE_EQUIPMENT: ['RESCUE', 'RESCUE_EQUIPMENT'],
};
const NON_INVENTORY_NEEDS = new Set(['URGENT', 'EMERGENCY']);
const SHELTER_NEEDS = new Set(['SHELTER', 'EVACUATION']);

function toNativeNumber(value) {
  if (value && typeof value.toNumber === 'function') return value.toNumber();
  return Number(value ?? 0);
}

function matchingResources(needsValue, stockValue, capacityValue) {
  const needs = [...new Set((needsValue ?? []).map((need) => String(need).trim().toUpperCase()).filter(Boolean))];
  const requiresShelter = needs.some((need) => SHELTER_NEEDS.has(need));
  const resourceGroups = needs
    .filter((need) => !NON_INVENTORY_NEEDS.has(need) && !SHELTER_NEEDS.has(need))
    .map((need) => NEED_ALIASES[need] ?? [need]);
  const availableStock = (stockValue ?? [])
    .filter((resource) => resource && toNativeNumber(resource.quantity) > 0)
    .map((resource) => ({
      category: resource.category,
      item: resource.item,
      quantity: toNativeNumber(resource.quantity),
      unit: resource.unit,
    }));

  const covered = resourceGroups.every((group) => availableStock.some((resource) => group.includes(resource.category)));
  const capacityFree = toNativeNumber(capacityValue);
  if (!covered || (requiresShelter && capacityFree <= 0)) return null;

  const requestedCategories = new Set(resourceGroups.flat());
  const availableResources = resourceGroups.length || requiresShelter
    ? availableStock.filter((resource) => requestedCategories.has(resource.category))
    : availableStock;
  if (requiresShelter) {
    availableResources.push({ category: 'SHELTER', item: 'beds', quantity: capacityFree, unit: 'beds' });
  }
  return availableResources;
}

export async function findDispatchCandidates(incidentId) {
  let driver;
  try {
    driver = await getNeo4jDriver();
  } catch (error) {
    throw error instanceof AppError ? error : new AppError(503, 'Neo4j reachability service is unavailable.');
  }

  const session = driver.session({ database: neo4jDatabaseName() });
  try {
    const result = await session.executeRead((transaction) => transaction.run(REACHABILITY_QUERY, { incidentId: String(incidentId) }));
    if (!result.records.length) {
      const graphIncident = await session.executeRead((transaction) => transaction.run(
        'MATCH (incident:Incident {id: $incidentId}) RETURN incident.id AS id LIMIT 1',
        { incidentId: String(incidentId) },
      ));
      if (!graphIncident.records.length) {
        const existsInMongo = await Incident.exists({ _id: incidentId });
        if (!existsInMongo) throw new AppError(404, 'Incident not found.');
        throw new AppError(503, 'Incident is not present in the Neo4j response graph. Run the graph seed script.');
      }
    }

    const responderResult = await session.executeRead((transaction) => transaction.run(
      RESPONDER_REACHABILITY_QUERY, { incidentId: String(incidentId) },
    ));
    const candidates = [];
    for (const record of result.records) {
      const availableResources = matchingResources(record.get('needs'), record.get('stock'), record.get('capacityFree'));
      if (!availableResources) continue;
      candidates.push({
        facilityId: record.get('facilityId'),
        facilityName: record.get('facilityName'),
        travelTime: toNativeNumber(record.get('travelTime')),
        availableResources,
        zone: record.get('zone'),
      });
    }
    const facilities = candidates
      .sort((left, right) => left.travelTime - right.travelTime || left.facilityName.localeCompare(right.facilityName))
      .slice(0, 5);
    const responders = responderResult.records.map((record) => ({
      responderId: record.get('responderId'),
      role: record.get('role'),
      teamId: record.get('teamId'),
      travelTime: toNativeNumber(record.get('travelTime')),
      zone: record.get('zone'),
    })).sort((left, right) => left.travelTime - right.travelTime || left.responderId.localeCompare(right.responderId)).slice(0, 5);
    return { facilities, responders };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Neo4j dispatch candidate query failed:', error.message);
    throw new AppError(503, 'Could not calculate reachable facilities.');
  } finally {
    await session.close();
  }
}
