import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Alert, Allocation, Facility, Incident, Resource, User } from '../src/models/index.js';
import { allSeedIds } from './seedData.js';

const models = { users: User, incidents: Incident, facilities: Facility, resources: Resource, allocations: Allocation, alerts: Alert };
let connected = false;

try {
  connected = await connectDatabase();
  if (!connected) throw new Error('Clear aborted: could not connect to MongoDB Atlas.');

  const ids = allSeedIds();
  for (const [collection, Model] of Object.entries(models)) {
    const result = await Model.deleteMany({ _id: { $in: ids[collection] } });
    console.log(`${collection}: removed ${result.deletedCount} seeded records.`);
  }
  console.log('Seed cleanup complete. Records outside this seed ID set were not touched.');
} catch (error) {
  console.error(`Seed cleanup failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (connected || mongoose.connection.readyState !== 0) await disconnectDatabase();
}
