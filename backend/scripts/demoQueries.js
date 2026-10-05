// Review 2 database demonstration: runs CRUD, index and aggregation operations
// directly against MongoDB and prints the results. Safe to run repeatedly; the
// CRUD section creates and then deletes its own temporary records.
//   cd backend && npm run demo:queries
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Facility, Incident, Resource, User } from '../src/models/index.js';
import * as analytics from '../src/services/analyticsService.js';

const line = (title) => console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
const show = (value) => console.log(Array.isArray(value) ? value.map((item) => `  ${JSON.stringify(item)}`).join('\n') : `  ${JSON.stringify(value)}`);

let connected = false;
try {
  connected = await connectDatabase();
  if (!connected) throw new Error('Could not connect to MongoDB.');

  line('1. CRUD on the incidents collection');
  const reporter = await User.findOne({ role: 'CITIZEN' }).lean();
  const created = await Incident.create({
    reporter_id: reporter._id, type: 'FLOOD', severity: 'HIGH', status: 'REPORTED',
    description: 'Demo: water entering homes on 3rd street', people_affected: 30,
    location: { type: 'Point', coordinates: [80.2301, 13.0102] }, zone_code: 'Z-07', needs: ['WATER', 'EVACUATION'],
  });
  console.log('CREATE  insertOne ->', String(created._id));
  const read = await Incident.findById(created._id).lean();
  console.log('READ    findById  ->', read.type, read.severity, read.status, read.zone_code);
  const updated = await Incident.findByIdAndUpdate(created._id,
    { $set: { status: 'VERIFIED', 'verification.state': 'VERIFIED' }, $push: { needs: 'FOOD' }, $inc: { people_affected: 5 } },
    { new: true }).lean();
  console.log('UPDATE  $set/$push/$inc ->', updated.status, updated.needs, updated.people_affected);
  const deleted = await Incident.deleteOne({ _id: created._id });
  console.log('DELETE  deleteOne ->', deleted.deletedCount, 'document removed');

  line('2. Indexes per collection');
  for (const { collection, documents, indexes } of await analytics.listIndexes()) {
    console.log(`${collection} (${documents} docs)`);
    for (const index of indexes) console.log(`   ${index.name.padEnd(40)} ${JSON.stringify(index.key)}${index.unique ? ' UNIQUE' : ''}${index.partial ? ' PARTIAL' : ''}`);
  }

  line('3. Query plans (explain executionStats)');
  for (const { name } of analytics.explainQueryNames()) {
    const { description, summary } = await analytics.explainQuery(name);
    console.log(`${description}\n   -> stage=${summary.winning_stage} index=${summary.index_used} keysExamined=${summary.keys_examined} docsExamined=${summary.docs_examined} returned=${summary.docs_returned}`);
  }

  line('4. Geospatial + text queries');
  show((await Facility.find({ location: { $near: { $geometry: { type: 'Point', coordinates: [80.24, 13.02] }, $maxDistance: 3000 } } })
    .select('name kind zone_code').limit(3).lean()));
  show(await Incident.find({ $text: { $search: 'water rescue' } }, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } }).select('description').limit(3).lean());

  line('5. Aggregation pipelines');
  console.log('-- $facet dashboard summary');
  show((await analytics.dashboardSummary()).totals);
  console.log('-- incidents grouped by type');
  show(await analytics.groupIncidentsBy('type'));
  console.log('-- zone hotspots ($group + $lookup)');
  show((await analytics.zoneHotspots()).slice(0, 5));
  console.log('-- nearest facilities ($geoNear + $lookup)');
  show(await analytics.nearestFacilities({ longitude: 80.24, latitude: 13.02, limit: 3 }));
  console.log('-- allocation response times (timeline array)');
  show(await analytics.allocationResponseTimes());
  console.log('-- incident size buckets ($bucket)');
  show(await analytics.incidentSizeBuckets());
  console.log('-- resource availability ($group + $lookup)');
  show((await analytics.aggregateResourceAvailability()).slice(0, 5));
  console.log(`\nResources in collection: ${await Resource.countDocuments()}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (connected || mongoose.connection.readyState !== 0) await disconnectDatabase();
}
