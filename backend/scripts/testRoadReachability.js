import 'dotenv/config';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { closeNeo4j, connectNeo4j, neo4jDatabaseName } from '../src/config/neo4j.js';
import { Facility, Incident, Resource, Road, User } from '../src/models/index.js';
import { findDispatchCandidates } from '../src/services/dispatchService.js';
import { rebuildNeo4jFromMongo } from './seedGraph.js';

const dataset = 'resq-district';
const activeStatuses = ['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'];
const temporary = { incidents: [], facilities: [], resources: [] };
let connected = false;
let failed = false;

function countFrom(record) {
  return record.get('count')?.toNumber?.() ?? Number(record.get('count') ?? 0);
}

async function verifyProjection() {
  const [mongoRoads, driver] = await Promise.all([
    Road.find({}).sort({ road_id: 1 }).lean(),
    connectNeo4j(),
  ]);
  const session = driver.session({ database: neo4jDatabaseName() });
  try {
    const nodeCounts = {};
    for (const label of ['Zone', 'Incident', 'Facility', 'Responder', 'Team', 'Resource']) {
      const result = await session.run(`MATCH (n:${label} {dataset: $dataset}) RETURN count(n) AS count`, { dataset });
      nodeCounts[label] = countFrom(result.records[0]);
      assert(nodeCounts[label] > 0, `No ${label} nodes were rebuilt.`);
    }

    const relationshipCounts = {};
    for (const relationship of ['LOCATED_IN', 'ROAD_TO', 'CONTAINS', 'STOCKS', 'BASED_AT', 'ASSIGNED_TO', 'MEMBER_OF']) {
      const result = await session.run(
        `MATCH (a {dataset: $dataset})-[r:${relationship}]->(b {dataset: $dataset}) RETURN count(r) AS count`,
        { dataset },
      );
      relationshipCounts[relationship] = countFrom(result.records[0]);
      assert(relationshipCounts[relationship] > 0, `No ${relationship} relationships were rebuilt.`);
    }

    const result = await session.run(
      `MATCH (from:Zone {dataset: $dataset})-[road:ROAD_TO]->(to:Zone {dataset: $dataset})
       RETURN road.road_id AS roadId, from.id AS fromZone, to.id AS toZone,
              road.status AS status, road.travel_minutes AS travelMinutes`,
      { dataset },
    );
    const projected = new Map(result.records.map((record) => [
      `${record.get('roadId')}|${record.get('fromZone')}|${record.get('toZone')}`,
      `${record.get('status')}|${record.get('travelMinutes')?.toNumber?.() ?? Number(record.get('travelMinutes'))}`,
    ]));
    assert.equal(projected.size, mongoRoads.length * 2, 'Each Mongo road must project to two directed ROAD_TO relationships.');
    for (const road of mongoRoads) {
      for (const [fromZone, toZone] of [[road.from_zone, road.to_zone], [road.to_zone, road.from_zone]]) {
        assert.equal(
          projected.get(`${road.road_id}|${fromZone}|${toZone}`),
          `${road.status}|${road.travel_minutes}`,
          `Neo4j ROAD_TO does not match Mongo road ${road.road_id}.`,
        );
      }
    }
    console.log('Verified Neo4j node counts:', JSON.stringify(nodeCounts));
    console.log('Verified Neo4j relationship counts:', JSON.stringify(relationshipCounts));
    console.log(`Verified ${mongoRoads.length} Mongo road records against ${projected.size} directed ROAD_TO relationships.`);
    return { nodeCounts, relationshipCounts, roadCount: mongoRoads.length };
  } finally {
    await session.close();
    await driver.close();
  }
}

async function createReachabilityFixtures() {
  const reporter = await User.findOne({ role: 'CITIZEN' }).select('_id').lean();
  const blockedRoadIncident = await Incident.create({
    reporter_id: reporter._id, type: 'FLOOD', severity: 'HIGH', status: 'REPORTED',
    description: 'Synthetic road reachability test: blocked shortcut.', people_affected: 2,
    location: { type: 'Point', coordinates: [80.2, 13.0] }, zone_code: 'Z-01', needs: ['BEDDING'],
  });
  temporary.incidents.push(blockedRoadIncident._id);
  const blockedTestFacility = await Facility.create({
    name: 'Synthetic blocked-road test facility', kind: 'RELIEF_CENTRE', zone_code: 'Z-04',
    location: { type: 'Point', coordinates: [80.25, 13.05] }, capacity_total: 10, capacity_free: 8, operational: true,
  });
  temporary.facilities.push(blockedTestFacility._id);
  const blockedTestResource = await Resource.create({
    facility_id: blockedTestFacility._id, category: 'BEDDING', item: 'synthetic bedding', quantity: 100, reserved: 0, unit: 'kits',
  });
  temporary.resources.push(blockedTestResource._id);

  const floodedRoadIncident = await Incident.create({
    reporter_id: reporter._id, type: 'FLOOD', severity: 'HIGH', status: 'REPORTED',
    description: 'Synthetic road reachability test: flooded shortcut.', people_affected: 2,
    location: { type: 'Point', coordinates: [80.21, 13.01] }, zone_code: 'Z-02', needs: ['FOOD'],
  });
  temporary.incidents.push(floodedRoadIncident._id);
  const floodedTestFacility = await Facility.create({
    name: 'Synthetic flooded-road test facility', kind: 'RELIEF_CENTRE', zone_code: 'Z-06',
    location: { type: 'Point', coordinates: [80.3, 13.06] }, capacity_total: 10, capacity_free: 8, operational: true,
  });
  temporary.facilities.push(floodedTestFacility._id);
  const floodedTestResource = await Resource.create({
    facility_id: floodedTestFacility._id, category: 'FOOD', item: 'synthetic food', quantity: 100, reserved: 0, unit: 'meals',
  });
  temporary.resources.push(floodedTestResource._id);
  return { blockedRoadIncident, blockedTestFacility, floodedRoadIncident, floodedTestFacility };
}

async function verifyReachability() {
  const fixtures = await createReachabilityFixtures();
  await rebuildNeo4jFromMongo();

  const blockedResult = await findDispatchCandidates(String(fixtures.blockedRoadIncident._id));
  const blockedCandidate = blockedResult.facilities.find((candidate) => candidate.facilityId === String(fixtures.blockedTestFacility._id));
  assert(blockedCandidate, 'No candidate returned through the open alternate route around the BLOCKED road.');
  assert.equal(blockedCandidate.travelTime, 21, 'Reachability used the BLOCKED shortcut instead of the 21-minute OPEN alternate path.');

  const floodedResult = await findDispatchCandidates(String(fixtures.floodedRoadIncident._id));
  const floodedCandidate = floodedResult.facilities.find((candidate) => candidate.facilityId === String(fixtures.floodedTestFacility._id));
  assert(floodedCandidate, 'No candidate returned through the open alternate route around the FLOODED road.');
  assert.equal(floodedCandidate.travelTime, 34, 'Reachability used the FLOODED shortcut instead of the 34-minute OPEN alternate path.');
  assert(floodedCandidate.availableResources.some((resource) => resource.category === 'FOOD' && resource.quantity === 100));
  console.log('Reachability passed: BLOCKED and FLOODED shortcuts were excluded; OPEN routes returned expected travel times and inventory.');
}

try {
  connected = await connectDatabase();
  if (!connected) throw new Error('Could not connect to MongoDB Atlas.');
  await verifyProjection();
  await verifyReachability();
} catch (error) {
  failed = true;
  console.error('Road reachability integration test failed:', error.message);
} finally {
  if (connected) {
    if (temporary.resources.length) await Resource.deleteMany({ _id: { $in: temporary.resources } });
    if (temporary.facilities.length) await Facility.deleteMany({ _id: { $in: temporary.facilities } });
    if (temporary.incidents.length) await Incident.deleteMany({ _id: { $in: temporary.incidents } });
    if (temporary.incidents.length || temporary.facilities.length || temporary.resources.length) {
      try { await rebuildNeo4jFromMongo(); }
      catch (error) { failed = true; console.error('Could not restore the canonical Neo4j projection after cleanup:', error.message); }
    }
    await disconnectDatabase();
  } else if (mongoose.connection.readyState !== 0) {
    await disconnectDatabase();
  }
  await closeNeo4j();
}
if (failed) process.exitCode = 1;
