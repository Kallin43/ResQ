import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Facility, Incident, Road } from '../src/models/index.js';
import { roadIdFor } from '../src/utils/roadId.js';

function compareZones(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function roadRecord(fromZone, toZone, status, travelMinutes) {
  const [from_zone, to_zone] = [fromZone, toZone].sort();
  return {
    road_id: roadIdFor(from_zone, to_zone),
    from_zone,
    to_zone,
    status,
    travel_minutes: travelMinutes,
  };
}

export function buildSyntheticRoadDataset(zones) {
  const orderedZones = [...new Set(zones)].sort(compareZones);
  if (orderedZones.length < 2) throw new Error('At least two district zones are required to seed road segments.');

  const roads = orderedZones.map((zone, index) => roadRecord(
    zone,
    orderedZones[(index + 1) % orderedZones.length],
    'OPEN',
    6 + (index % 7),
  ));

  if (orderedZones.length >= 16) {
    roads.push(
      roadRecord(orderedZones[0], orderedZones[3], 'BLOCKED', 2),
      roadRecord(orderedZones[1], orderedZones[5], 'FLOODED', 3),
      roadRecord(orderedZones[6], orderedZones[11], 'BLOCKED', 4),
      roadRecord(orderedZones[10], orderedZones[15], 'FLOODED', 4),
      roadRecord(orderedZones[2], orderedZones[8], 'OPEN', 11),
      roadRecord(orderedZones[12], orderedZones[18], 'OPEN', 13),
    );
  }

  return [...new Map(roads.map((road) => [road.road_id, road])).values()];
}

export async function seedRoads() {
  let connected = false;
  try {
    connected = await connectDatabase();
    if (!connected) throw new Error('Road seed aborted: could not connect to MongoDB Atlas.');

    const [facilities, incidents] = await Promise.all([
      Facility.find({}).select('zone_code').lean(),
      Incident.find({ status: { $in: ['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'] } }).select('zone_code').lean(),
    ]);
    const zones = [...new Set([...facilities, ...incidents].map(({ zone_code }) => zone_code).filter(Boolean))];
    if (zones.length !== 20) throw new Error(`Expected 20 zones in the selected district, found ${zones.length}.`);

    const roads = buildSyntheticRoadDataset(zones);
    const operations = roads.map((road) => ({
      updateOne: {
        filter: { road_id: road.road_id },
        update: { $set: road },
        upsert: true,
        runValidators: true,
      },
    }));
    const result = await Road.bulkWrite(operations, { ordered: true });
    const [total, statusCounts] = await Promise.all([
      Road.countDocuments({}),
      Road.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    console.log(`Seeded ${roads.length} synthetic road segments across ${zones.length} zones (${result.upsertedCount} inserted, ${result.modifiedCount} updated).`);
    console.log(`Road collection now contains ${total} records. Status counts: ${statusCounts.map(({ _id, count }) => `${_id}=${count}`).join(', ')}.`);
    return { roads: roads.length, zones: zones.length, total, statuses: Object.fromEntries(statusCounts.map(({ _id, count }) => [_id, count])) };
  } catch (error) {
    console.error(`Road seed failed: ${error.message}`);
    process.exitCode = 1;
    throw error;
  } finally {
    if (connected || mongoose.connection.readyState !== 0) await disconnectDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedRoads().catch(() => {});
}
