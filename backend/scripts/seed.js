import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Alert, Allocation, Facility, Incident, Resource, User } from '../src/models/index.js';
import { allSeedIds, SEED_PASSWORD, seedRecords } from './seedData.js';

const models = { users: User, incidents: Incident, facilities: Facility, resources: Resource, allocations: Allocation, alerts: Alert };
let connected = false;

try {
  connected = await connectDatabase();
  if (!connected) throw new Error('Seed aborted: could not connect to MongoDB Atlas.');

  const userIds = allSeedIds().users;
  const existingUsers = new Set((await User.find({ _id: { $in: userIds } }).select('_id').lean()).map(({ _id }) => String(_id)));

  for (const [collection, records] of Object.entries(seedRecords)) {
    const Model = models[collection];
    const operations = await Promise.all(records.map(async (record) => {
      const { _id, ...fields } = record;
      const update = { $set: fields, $setOnInsert: { _id } };
      if (collection === 'users' && !existingUsers.has(String(_id))) {
        update.$setOnInsert.password_hash = await bcrypt.hash(SEED_PASSWORD, 10);
      }
      return { updateOne: { filter: { _id }, update, upsert: true, runValidators: true } };
    }));
    await Model.bulkWrite(operations, { ordered: true });
    const total = await Model.countDocuments({ _id: { $in: records.map(({ _id }) => _id) } });
    if (total !== records.length) throw new Error(`${collection}: expected ${records.length} seeded records, found ${total}.`);
    console.log(`${collection}: ${total} synthetic records ready.`);
  }
  console.log('Seed complete. All records use deterministic IDs; rerunning updates this development dataset.');
  console.log(`Development-only shared password for synthetic users: ${SEED_PASSWORD}`);
} catch (error) {
  console.error(`Seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (connected || mongoose.connection.readyState !== 0) await disconnectDatabase();
}
