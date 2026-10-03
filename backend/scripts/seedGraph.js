import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { connectNeo4j, neo4jDatabaseName } from '../src/config/neo4j.js';
import { Allocation, Facility, Incident, Resource, Road, User } from '../src/models/index.js';

const DATASET = 'resq-district';
const OPEN_INCIDENTS = ['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'];
const ACTIVE_ALLOCATIONS = ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];
const RESPONDER_ROLES = ['VOLUNTEER', 'RESCUE_LEAD'];
const constraints = [
  'CREATE CONSTRAINT resq_zone_id IF NOT EXISTS FOR (n:Zone) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT resq_incident_id IF NOT EXISTS FOR (n:Incident) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT resq_facility_id IF NOT EXISTS FOR (n:Facility) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT resq_responder_id IF NOT EXISTS FOR (n:Responder) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT resq_team_id IF NOT EXISTS FOR (n:Team) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT resq_resource_id IF NOT EXISTS FOR (n:Resource) REQUIRE n.id IS UNIQUE',
];

const id = (mongoId) => String(mongoId);
const geo = (point) => point?.coordinates?.length === 2
  ? { longitude: Number(point.coordinates[0]), latitude: Number(point.coordinates[1]) }
  : null;
function distanceKm(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latDelta = radians(right.latitude - left.latitude);
  const lonDelta = radians(right.longitude - left.longitude);
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function nearestZone(point, zones) {
  if (!point || !zones.length) return null;
  return zones.filter((zone) => Number.isFinite(zone.longitude) && Number.isFinite(zone.latitude)).reduce((nearest, zone) => {
    const distance = distanceKm(point, zone);
    return !nearest || distance < nearest.distance ? { id: zone.id, distance } : nearest;
  }, null)?.id ?? null;
}

export async function loadCurrentGraph() {
  const [incidents, facilities, resources, allocations, responders, roadRecords] = await Promise.all([
    Incident.find({ status: { $in: OPEN_INCIDENTS } }).lean(),
    Facility.find({}).lean(),
    Resource.find({}).lean(),
    Allocation.find({ state: { $in: ACTIVE_ALLOCATIONS } }).lean(),
    User.find({ role: { $in: RESPONDER_ROLES }, available: true }).lean(),
    Road.find({}).lean(),
  ]);

  const activeIncidentIds = new Set(incidents.map(({ _id }) => id(_id)));
  const activeAllocations = allocations.filter((allocation) => activeIncidentIds.has(id(allocation.incident_id)));
  const responderIds = new Set(responders.map(({ _id }) => id(_id)));
  for (const allocation of activeAllocations) {
    if (allocation.responder_id) responderIds.add(id(allocation.responder_id));
  }
  const responderById = new Map(responders.map((responder) => [id(responder._id), responder]));
  const missingResponderIds = [...responderIds].filter((responderId) => !responderById.has(responderId));
  if (missingResponderIds.length) {
    const assignedResponders = await User.find({ _id: { $in: missingResponderIds }, role: { $in: RESPONDER_ROLES } }).lean();
    for (const responder of assignedResponders) responderById.set(id(responder._id), responder);
  }
  const currentResponders = [...responderById.values()];

  const zonePoints = new Map();
  const addZone = (zoneCode) => {
    if (zoneCode && !zonePoints.has(zoneCode)) zonePoints.set(zoneCode, []);
  };
  const addZonePoint = (zoneCode, point) => {
    if (!zoneCode || !point) return;
    addZone(zoneCode);
    zonePoints.get(zoneCode).push(point);
  };
  for (const facility of facilities) addZonePoint(facility.zone_code, geo(facility.location));
  for (const incident of incidents) addZonePoint(incident.zone_code || 'UNASSIGNED', geo(incident.location));

  for (const road of roadRecords) {
    addZone(road.from_zone);
    addZone(road.to_zone);
  }
  const zones = [...zonePoints].map(([code, points]) => ({
    id: code,
    code,
    dataset: DATASET,
    district: process.env.RESQ_DISTRICT_NAME || 'Chennai District',
    longitude: points.length ? points.reduce((sum, point) => sum + point.longitude, 0) / points.length : null,
    latitude: points.length ? points.reduce((sum, point) => sum + point.latitude, 0) / points.length : null,
  }));
  const zoneIds = new Set(zones.map(({ id: zoneId }) => zoneId));
  const graphRoads = roadRecords.filter((road) => zoneIds.has(road.from_zone) && zoneIds.has(road.to_zone)).flatMap((road) => [
    { road_id: road.road_id, from: road.from_zone, to: road.to_zone, status: road.status, travel_minutes: road.travel_minutes },
    { road_id: road.road_id, from: road.to_zone, to: road.from_zone, status: road.status, travel_minutes: road.travel_minutes },
  ]);

  const graph = {
    zones,
    incidents: incidents.filter(({ zone_code }) => zoneIds.has(zone_code || 'UNASSIGNED')).map((incident) => ({
      id: id(incident._id), dataset: DATASET, type: incident.type, severity: incident.severity,
      status: incident.status, zone_code: incident.zone_code || 'UNASSIGNED', people_affected: incident.people_affected,
      needs: incident.needs ?? [], reported_at: incident.reported_at?.toISOString?.() ?? null,
      ...Object.fromEntries(Object.entries(geo(incident.location) ?? {}).map(([key, value]) => [`location_${key}`, value])),
    })),
    facilities: facilities.map((facility) => ({
      id: id(facility._id), dataset: DATASET, name: facility.name, kind: facility.kind,
      zone_code: facility.zone_code, operational: facility.operational,
      capacity_total: facility.capacity_total, capacity_free: facility.capacity_free,
      ...Object.fromEntries(Object.entries(geo(facility.location) ?? {}).map(([key, value]) => [`location_${key}`, value])),
    })),
    resources: resources.map((resource) => ({
      id: id(resource._id), dataset: DATASET, category: resource.category, item: resource.item,
      quantity: resource.quantity, reserved: resource.reserved, unit: resource.unit,
    })),
    responders: currentResponders.map((responder) => {
      const location = geo(responder.location);
      return {
        id: id(responder._id), dataset: DATASET, role: responder.role, available: responder.available,
        skills: responder.skills ?? [], location_longitude: location?.longitude ?? null,
        location_latitude: location?.latitude ?? null, team_id: responder.team_id ? id(responder.team_id) : null,
      };
    }),
    teams: [...new Set([
      ...currentResponders.map(({ team_id }) => team_id && id(team_id)),
      ...activeAllocations.map(({ team_id }) => team_id && id(team_id)),
    ].filter(Boolean))]
      .map((teamId) => ({ id: teamId, dataset: DATASET })),
    roads: graphRoads,
    locatedIn: [],
    contains: [],
    stocks: [],
    basedAt: [],
    assignedTo: [],
    memberOf: [],
  };

  graph.locatedIn = graph.incidents.map((incident) => ({ incidentId: incident.id, zoneId: incident.zone_code }));
  graph.contains = graph.facilities.filter((facility) => zoneIds.has(facility.zone_code))
    .map((facility) => ({ zoneId: facility.zone_code, facilityId: facility.id }));
  const facilityById = new Map(facilities.map((facility) => [id(facility._id), facility]));
  graph.stocks = resources.filter((resource) => facilityById.has(id(resource.facility_id)))
    .map((resource) => ({ facilityId: id(resource.facility_id), resourceId: id(resource._id) }));
  const responderLocations = new Map(currentResponders.map((responder) => [id(responder._id), geo(responder.location)]));
  graph.basedAt = graph.responders.flatMap((responder) => {
    const zoneId = nearestZone(responderLocations.get(responder.id), zones);
    return zoneId ? [{ responderId: responder.id, zoneId }] : [];
  });
  graph.assignedTo = activeAllocations.filter((allocation) =>
    allocation.responder_id && responderById.has(id(allocation.responder_id)) && activeIncidentIds.has(id(allocation.incident_id)))
    .map((allocation) => ({ responderId: id(allocation.responder_id), incidentId: id(allocation.incident_id) }));
  graph.memberOf = graph.responders.filter((responder) => responder.team_id && graph.teams.some((team) => team.id === responder.team_id))
    .map((responder) => ({ responderId: responder.id, teamId: responder.team_id }));
  return graph;
}

async function run(cypher, rows, transaction) {
  if (!rows.length) return;
  await transaction.run(cypher, { rows });
}

export async function replaceDataset(driver, graph) {
  const session = driver.session({ database: neo4jDatabaseName() });
  try {
    for (const constraint of constraints) await session.run(constraint);
    await session.executeWrite(async (transaction) => {
      await transaction.run('MATCH (n {dataset: $dataset}) DETACH DELETE n', { dataset: DATASET });
      await run('UNWIND $rows AS row MERGE (n:Zone {id: row.id}) SET n += row', graph.zones, transaction);
      await run('UNWIND $rows AS row MERGE (n:Incident {id: row.id}) SET n += row', graph.incidents, transaction);
      await run('UNWIND $rows AS row MERGE (n:Facility {id: row.id}) SET n += row', graph.facilities, transaction);
      await run('UNWIND $rows AS row MERGE (n:Resource {id: row.id}) SET n += row', graph.resources, transaction);
      await run('UNWIND $rows AS row MERGE (n:Responder {id: row.id}) SET n += row', graph.responders, transaction);
      await run('UNWIND $rows AS row MERGE (n:Team {id: row.id}) SET n += row', graph.teams, transaction);
      await run('UNWIND $rows AS row MATCH (a:Zone {id: row.from}), (b:Zone {id: row.to}) MERGE (a)-[r:ROAD_TO {road_id: row.road_id}]->(b) SET r.status = row.status, r.travel_minutes = row.travel_minutes', graph.roads, transaction);
      await run('UNWIND $rows AS row MATCH (a:Incident {id: row.incidentId}), (b:Zone {id: row.zoneId}) MERGE (a)-[:LOCATED_IN]->(b)', graph.locatedIn, transaction);
      await run('UNWIND $rows AS row MATCH (a:Zone {id: row.zoneId}), (b:Facility {id: row.facilityId}) MERGE (a)-[:CONTAINS]->(b)', graph.contains, transaction);
      await run('UNWIND $rows AS row MATCH (a:Facility {id: row.facilityId}), (b:Resource {id: row.resourceId}) MERGE (a)-[:STOCKS]->(b)', graph.stocks, transaction);
      await run('UNWIND $rows AS row MATCH (a:Responder {id: row.responderId}), (b:Zone {id: row.zoneId}) MERGE (a)-[:BASED_AT]->(b)', graph.basedAt, transaction);
      await run('UNWIND $rows AS row MATCH (a:Responder {id: row.responderId}), (b:Incident {id: row.incidentId}) MERGE (a)-[:ASSIGNED_TO]->(b)', graph.assignedTo, transaction);
      await run('UNWIND $rows AS row MATCH (a:Responder {id: row.responderId}), (b:Team {id: row.teamId}) MERGE (a)-[:MEMBER_OF]->(b)', graph.memberOf, transaction);
    });
  } finally {
    await session.close();
  }
}

export async function rebuildNeo4jFromMongo() {
  const driver = await connectNeo4j();
  try {
    const graph = await loadCurrentGraph();
    await replaceDataset(driver, graph);
    console.log(`Rebuilt ${DATASET} graph from MongoDB: ${graph.zones.length} zones, ${graph.incidents.length} live incidents, ${graph.facilities.length} facilities, ${graph.responders.length} responders, ${graph.teams.length} teams, ${graph.resources.length} resources, ${graph.roads.length} directed road relationships.`);
    return graph;
  } finally { await driver.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let mongoConnected = false;
  try {
    mongoConnected = await connectDatabase();
    if (!mongoConnected) throw new Error('Could not connect to MongoDB Atlas.');
    await rebuildNeo4jFromMongo();
  } catch (error) {
    console.error(`Neo4j graph rebuild failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (mongoConnected) await disconnectDatabase();
  }
}
