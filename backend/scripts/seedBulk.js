// Bulk synthetic dataset for index and aggregation demonstrations.
// Adds 1,500 historical incidents spread over the last 30 days and 300 extra
// inventory lines, bringing the MongoDB dataset to roughly 2,000 documents.
// All IDs are deterministic, so rerunning updates instead of duplicating.
// Remove with: node scripts/seedBulk.js --clear
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Facility, Incident, Resource, User } from '../src/models/index.js';
import { classifySeverity } from '../src/services/incidentService.js';
import { seedObjectId } from './seedData.js';

const INCIDENTS = 1500;
const RESOURCES = 300;
const clear = process.argv.includes('--clear');

let state = 0xb01c;
const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
const pick = (values) => values[Math.floor(random() * values.length)];
const round = (n) => Number(n.toFixed(5));

const TYPES = ['FLOOD', 'FLOOD', 'FLOOD', 'CYCLONE', 'LANDSLIDE', 'FIRE', 'MEDICAL', 'MEDICAL', 'STRUCTURAL', 'EARTHQUAKE', 'OTHER'];
const NEEDS = [['WATER'], ['MEDICAL', 'EVACUATION'], ['FOOD', 'BEDDING'], ['RESCUE', 'URGENT'], ['POWER'], ['SHELTER'], ['WATER', 'FOOD']];
const PHRASES = {
  FLOOD: ['water level rising in ground floor homes', 'families stranded on rooftops, need boat water rescue', 'street flooded, elderly residents need evacuation'],
  CYCLONE: ['trees uprooted and power lines down', 'roof blown off community hall'],
  LANDSLIDE: ['mud slide blocked the approach road', 'two houses damaged by debris flow'],
  FIRE: ['kitchen fire spread to adjoining huts', 'smoke from warehouse fire'],
  MEDICAL: ['dialysis patient cannot reach hospital', 'injured person needs first aid and transport'],
  STRUCTURAL: ['cracks in apartment block after heavy rain', 'compound wall collapsed onto lane'],
  EARTHQUAKE: ['tremor damaged school building', 'people evacuated from cracked building'],
  OTHER: ['drinking water supply contaminated', 'stray livestock trapped in canal'],
};
const STOCK = [
  { category: 'FOOD', item: 'dry_rations', unit: 'kits' },
  { category: 'WATER', item: 'water_pouches', unit: 'litres' },
  { category: 'MEDICINE', item: 'ors_sachets', unit: 'packs' },
  { category: 'BEDDING', item: 'tarpaulins', unit: 'pieces' },
  { category: 'RESCUE_EQUIPMENT', item: 'rope_kits', unit: 'pieces' },
  { category: 'HYGIENE', item: 'hygiene_kits', unit: 'kits' },
];

const incidentIds = Array.from({ length: INCIDENTS }, (_, i) => seedObjectId(`bulk-incident:${i}`));
const resourceIds = Array.from({ length: RESOURCES }, (_, i) => seedObjectId(`bulk-resource:${i}`));

let connected = false;
try {
  connected = await connectDatabase();
  if (!connected) throw new Error('Could not connect to MongoDB.');

  if (clear) {
    const a = await Incident.deleteMany({ _id: { $in: incidentIds } });
    const b = await Resource.deleteMany({ _id: { $in: resourceIds } });
    console.log(`Removed ${a.deletedCount} bulk incidents and ${b.deletedCount} bulk resources.`);
  } else {
    const citizens = await User.find({ role: 'CITIZEN' }).select('_id').lean();
    const facilities = await Facility.find().select('_id zone_code location').lean();
    if (!citizens.length || !facilities.length) throw new Error('Run `npm run seed` first.');

    const now = Date.now();
    const incidentOps = incidentIds.map((_id, i) => {
      const type = pick(TYPES);
      const needs = pick(NEEDS);
      const people_affected = Math.floor(random() ** 2.2 * 180);
      const anchor = pick(facilities);
      const reported_at = new Date(now - Math.floor(random() * 30 * 24 * 60) * 60 * 1000 - 60 * 60 * 1000);
      const ageDays = (now - reported_at.getTime()) / 86400000;
      const status = ageDays > 3 ? pick(['RESOLVED', 'RESOLVED', 'RESOLVED', 'DUPLICATE', 'UNREACHABLE']) : pick(['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED']);
      const closed = ['RESOLVED', 'DUPLICATE', 'UNREACHABLE'].includes(status);
      const [lng, lat] = anchor.location.coordinates;
      const doc = {
        reporter_id: pick(citizens)._id,
        type,
        severity: classifySeverity({ type, people_affected, needs }),
        status,
        description: `${pick(PHRASES[type])} (${people_affected} people) near ${anchor.zone_code}.`,
        people_affected,
        location: { type: 'Point', coordinates: [round(lng + (random() - 0.5) * 0.02), round(lat + (random() - 0.5) * 0.02)] },
        zone_code: anchor.zone_code,
        needs,
        media: [],
        verification: { state: status === 'REPORTED' ? 'UNVERIFIED' : 'VERIFIED', verified_by: null, verified_at: null },
        reported_at,
        closed_at: closed ? new Date(reported_at.getTime() + (30 + Math.floor(random() * 600)) * 60 * 1000) : null,
      };
      return { updateOne: { filter: { _id }, update: { $set: doc }, upsert: true } };
    });
    for (let i = 0; i < incidentOps.length; i += 500) await Incident.bulkWrite(incidentOps.slice(i, i + 500), { ordered: false });

    const resourceOps = resourceIds.map((_id, i) => {
      const stock = STOCK[i % STOCK.length];
      const facility = facilities[Math.floor(i / STOCK.length) % facilities.length];
      const quantity = 20 + Math.floor(random() * 480);
      return {
        updateOne: {
          filter: { _id },
          update: { $set: { facility_id: facility._id, ...stock, item: `${stock.item}_${String(Math.floor(i / (STOCK.length * facilities.length)) + 1)}`, quantity, reserved: 0 } },
          upsert: true,
        },
      };
    });
    await Resource.bulkWrite(resourceOps, { ordered: false });
    console.log(`Bulk dataset ready: ${INCIDENTS} incidents, ${RESOURCES} resources.`);
    console.log(`Totals now: incidents=${await Incident.countDocuments()}, resources=${await Resource.countDocuments()}`);
  }
} catch (error) {
  console.error(`Bulk seed failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (connected || mongoose.connection.readyState !== 0) await disconnectDatabase();
}
