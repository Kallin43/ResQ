import mongoose from 'mongoose';
import { Alert, Allocation, Facility, Incident, Resource, Road, User } from '../models/index.js';
import AppError from '../utils/AppError.js';

const incidentGroupFields = new Set(['type', 'severity', 'status', 'zone_code']);

export async function groupIncidentsBy(field) {
  if (!incidentGroupFields.has(field)) throw new AppError(400, 'Unsupported incident grouping.');
  const match = field === 'zone_code' ? { zone_code: { $type: 'string', $ne: '' } } : {};
  return Incident.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
}

export async function aggregateResourceAvailability({ facilityId, category } = {}) {
  const match = {};
  if (facilityId !== undefined) {
    if (!mongoose.isValidObjectId(facilityId)) throw new AppError(400, 'facility_id must be a valid MongoDB ID.');
    match.facility_id = new mongoose.Types.ObjectId(facilityId);
  }
  if (category !== undefined) match.category = category;

  return Resource.aggregate([
    { $match: match },
    {
      $group: {
        _id: { facility_id: '$facility_id', category: '$category' },
        item_count: { $sum: 1 },
        total_quantity: { $sum: '$quantity' },
        reserved_quantity: { $sum: '$reserved' },
        available_quantity: { $sum: { $max: [0, { $subtract: ['$quantity', '$reserved'] }] } },
      },
    },
    { $lookup: { from: 'facilities', localField: '_id.facility_id', foreignField: '_id', as: 'facility' } },
    { $unwind: '$facility' },
    {
      $project: {
        _id: 0,
        facility_id: '$_id.facility_id',
        facility_name: '$facility.name',
        facility_kind: '$facility.kind',
        zone_code: '$facility.zone_code',
        category: '$_id.category',
        item_count: 1,
        total_quantity: 1,
        reserved_quantity: 1,
        available_quantity: 1,
      },
    },
    { $sort: { facility_name: 1, category: 1 } },
  ]);
}

export async function groupAllocationsByState() {
  return Allocation.aggregate([
    { $group: { _id: '$state', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
}

export async function aggregateFacilityUtilization() {
  return Facility.aggregate([
    {
      $lookup: {
        from: 'resources',
        localField: '_id',
        foreignField: 'facility_id',
        pipeline: [{
          $group: {
            _id: null,
            item_count: { $sum: 1 },
            total_quantity: { $sum: '$quantity' },
            reserved_quantity: { $sum: '$reserved' },
            available_quantity: { $sum: { $max: [0, { $subtract: ['$quantity', '$reserved'] }] } },
          },
        }],
        as: 'resource_summary',
      },
    },
    { $unwind: { path: '$resource_summary', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        name: 1,
        kind: 1,
        zone_code: 1,
        operational: 1,
        capacity_total: 1,
        capacity_free: 1,
        capacity_used: { $max: [0, { $subtract: ['$capacity_total', '$capacity_free'] }] },
        capacity_utilization_percent: {
          $cond: [
            { $gt: ['$capacity_total', 0] },
            { $round: [{ $multiply: [{ $divide: [{ $max: [0, { $subtract: ['$capacity_total', '$capacity_free'] }] }, '$capacity_total'] }, 100] }, 1] },
            0,
          ],
        },
        resource_item_count: { $ifNull: ['$resource_summary.item_count', 0] },
        resource_total_quantity: { $ifNull: ['$resource_summary.total_quantity', 0] },
        resource_reserved_quantity: { $ifNull: ['$resource_summary.reserved_quantity', 0] },
        resource_available_quantity: { $ifNull: ['$resource_summary.available_quantity', 0] },
      },
    },
    { $sort: { name: 1 } },
  ]);
}

const ACTIVE_ALLOCATION_STATES = ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];
const OPEN_INCIDENT_STATUSES = ['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'];

// A1. Single-round-trip operations summary using $facet: several independent
// sub-pipelines run over the same incident set.
export async function dashboardSummary() {
  const [result] = await Incident.aggregate([
    {
      $facet: {
        totals: [{
          $group: {
            _id: null,
            total_incidents: { $sum: 1 },
            open_incidents: { $sum: { $cond: [{ $in: ['$status', OPEN_INCIDENT_STATUSES] }, 1, 0] } },
            critical_open: { $sum: { $cond: [{ $and: [{ $eq: ['$severity', 'CRITICAL'] }, { $in: ['$status', OPEN_INCIDENT_STATUSES] }] }, 1, 0] } },
            people_affected: { $sum: '$people_affected' },
          },
        }, { $project: { _id: 0 } }],
        by_type: [{ $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        by_severity: [{ $group: { _id: '$severity', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        latest: [{ $sort: { reported_at: -1 } }, { $limit: 5 }, { $project: { type: 1, severity: 1, status: 1, zone_code: 1, reported_at: 1 } }],
      },
    },
  ]);
  return { ...result, totals: result?.totals?.[0] ?? {} };
}

// A2. Daily incident trend split by severity ($dateToString bucketing + re-grouping).
export async function incidentTrend({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return Incident.aggregate([
    { $match: { reported_at: { $gte: since } } },
    {
      $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$reported_at' } }, severity: '$severity' },
        count: { $sum: 1 },
        people_affected: { $sum: '$people_affected' },
      },
    },
    {
      $group: {
        _id: '$_id.day',
        total: { $sum: '$count' },
        people_affected: { $sum: '$people_affected' },
        by_severity: { $push: { k: '$_id.severity', v: '$count' } },
      },
    },
    { $project: { _id: 0, day: '$_id', total: 1, people_affected: 1, by_severity: { $arrayToObject: '$by_severity' } } },
    { $sort: { day: 1 } },
  ]);
}

// A3. Zone hotspot ranking: open incident pressure per zone joined with the free
// shelter/hospital capacity in that zone (correlated $lookup: localField/foreignField + sub-pipeline).
export async function zoneHotspots() {
  return Incident.aggregate([
    { $match: { status: { $in: OPEN_INCIDENT_STATUSES }, zone_code: { $type: 'string', $ne: '' } } },
    {
      $group: {
        _id: '$zone_code',
        open_incidents: { $sum: 1 },
        critical: { $sum: { $cond: [{ $eq: ['$severity', 'CRITICAL'] }, 1, 0] } },
        people_affected: { $sum: '$people_affected' },
        types: { $addToSet: '$type' },
      },
    },
    {
      $lookup: {
        from: 'facilities',
        localField: '_id',
        foreignField: 'zone_code',
        pipeline: [
          { $match: { operational: true } },
          { $group: { _id: null, facilities: { $sum: 1 }, capacity_free: { $sum: '$capacity_free' } } },
        ],
        as: 'capacity',
      },
    },
    { $unwind: { path: '$capacity', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        zone_code: '$_id',
        open_incidents: 1,
        critical: 1,
        people_affected: 1,
        types: 1,
        facilities: { $ifNull: ['$capacity.facilities', 0] },
        capacity_free: { $ifNull: ['$capacity.capacity_free', 0] },
        // Weighted pressure score: critical incidents count three times.
        pressure_score: { $add: ['$open_incidents', { $multiply: ['$critical', 2] }] },
      },
    },
    { $sort: { pressure_score: -1, people_affected: -1 } },
  ]);
}

// A4. Nearest operational facilities to a point with $geoNear (must be the first stage;
// uses the facilities.location 2dsphere index), enriched with available stock.
export async function nearestFacilities({ longitude, latitude, maxDistanceM = 10000, kind, limit = 5 }) {
  const query = { operational: true };
  if (kind) query.kind = kind;
  return Facility.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distance_m',
        maxDistance: maxDistanceM,
        query,
        spherical: true,
      },
    },
    { $limit: limit },
    {
      $lookup: {
        from: 'resources',
        localField: '_id',
        foreignField: 'facility_id',
        pipeline: [{ $group: { _id: '$category', available: { $sum: { $subtract: ['$quantity', '$reserved'] } } } }, { $sort: { _id: 1 } }],
        as: 'stock',
      },
    },
    {
      $project: {
        name: 1, kind: 1, zone_code: 1, capacity_free: 1, capacity_total: 1,
        distance_km: { $round: [{ $divide: ['$distance_m', 1000] }, 2] },
        stock: { $map: { input: '$stock', as: 's', in: { category: '$$s._id', available: '$$s.available' } } },
      },
    },
  ]);
}

// A5. Allocation response-time statistics derived from the embedded timeline array.
export async function allocationResponseTimes() {
  const firstAt = (state) => ({
    $let: {
      vars: { entry: { $arrayElemAt: [{ $filter: { input: '$timeline', as: 't', cond: { $eq: ['$$t.state', state] } } }, 0] } },
      in: '$$entry.at',
    },
  });
  return Allocation.aggregate([
    { $match: { 'timeline.1': { $exists: true } } },
    { $project: { state: 1, proposed_at: firstAt('PROPOSED'), accepted_at: firstAt('ACCEPTED'), on_scene_at: firstAt('ON_SCENE'), completed_at: firstAt('COMPLETED') } },
    {
      $project: {
        state: 1,
        minutes_to_accept: { $cond: [{ $and: ['$accepted_at', '$proposed_at'] }, { $divide: [{ $subtract: ['$accepted_at', '$proposed_at'] }, 60000] }, null] },
        minutes_to_scene: { $cond: [{ $and: ['$on_scene_at', '$proposed_at'] }, { $divide: [{ $subtract: ['$on_scene_at', '$proposed_at'] }, 60000] }, null] },
        minutes_to_complete: { $cond: [{ $and: ['$completed_at', '$proposed_at'] }, { $divide: [{ $subtract: ['$completed_at', '$proposed_at'] }, 60000] }, null] },
      },
    },
    {
      $group: {
        _id: null,
        allocations_measured: { $sum: 1 },
        avg_minutes_to_accept: { $avg: '$minutes_to_accept' },
        avg_minutes_to_scene: { $avg: '$minutes_to_scene' },
        max_minutes_to_scene: { $max: '$minutes_to_scene' },
        avg_minutes_to_complete: { $avg: '$minutes_to_complete' },
      },
    },
    {
      $project: {
        _id: 0,
        allocations_measured: 1,
        avg_minutes_to_accept: { $round: ['$avg_minutes_to_accept', 1] },
        avg_minutes_to_scene: { $round: ['$avg_minutes_to_scene', 1] },
        max_minutes_to_scene: { $round: ['$max_minutes_to_scene', 1] },
        avg_minutes_to_complete: { $round: ['$avg_minutes_to_complete', 1] },
      },
    },
  ]);
}

// A6. Volunteer skill coverage: $unwind an array field, then count available responders per skill.
export async function responderSkillCoverage() {
  return User.aggregate([
    { $match: { role: { $in: ['VOLUNTEER', 'RESCUE_LEAD'] } } },
    { $unwind: '$skills' },
    {
      $group: {
        _id: '$skills',
        responders: { $sum: 1 },
        available: { $sum: { $cond: ['$available', 1, 0] } },
        rescue_leads: { $sum: { $cond: [{ $eq: ['$role', 'RESCUE_LEAD'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0, skill: '$_id', responders: 1, available: 1, rescue_leads: 1 } },
    { $sort: { responders: -1, skill: 1 } },
  ]);
}

// A7. Incident size distribution with $bucket on people_affected.
export async function incidentSizeBuckets() {
  return Incident.aggregate([
    {
      $bucket: {
        groupBy: '$people_affected',
        boundaries: [0, 5, 25, 100, 10001],
        default: 'unknown',
        output: { incidents: { $sum: 1 }, people: { $sum: '$people_affected' } },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        range: {
          $switch: {
            branches: [
              { case: { $eq: ['$_id', 0] }, then: '0-4' },
              { case: { $eq: ['$_id', 5] }, then: '5-24' },
              { case: { $eq: ['$_id', 25] }, then: '25-99' },
              { case: { $eq: ['$_id', 100] }, then: '100+' },
            ],
            default: 'unknown',
          },
        },
        incidents: 1,
        people: 1,
      },
    },
  ]);
}

// A8. Low-stock report: categories whose available quantity across all facilities is below a threshold.
export async function lowStock({ threshold = 50 } = {}) {
  return Resource.aggregate([
    { $project: { category: 1, item: 1, unit: 1, facility_id: 1, available: { $max: [0, { $subtract: ['$quantity', '$reserved'] }] } } },
    { $match: { available: { $lt: threshold } } },
    { $lookup: { from: 'facilities', localField: 'facility_id', foreignField: '_id', as: 'facility' } },
    { $unwind: '$facility' },
    { $project: { _id: 1, category: 1, item: 1, unit: 1, available: 1, facility: '$facility.name', zone_code: '$facility.zone_code' } },
    { $sort: { available: 1, category: 1 } },
  ]);
}

// ---------------------------------------------------------------------------
// Index introspection and query-plan evidence.

const INDEXED_COLLECTIONS = { users: User, incidents: Incident, facilities: Facility, resources: Resource, allocations: Allocation, alerts: Alert, roads: Road };

export async function listIndexes() {
  const out = [];
  for (const [collection, model] of Object.entries(INDEXED_COLLECTIONS)) {
    let indexes = [];
    try { indexes = await model.collection.indexes(); } catch (error) { if (error.codeName !== 'NamespaceNotFound') throw error; }
    out.push({
      collection,
      documents: await model.countDocuments({}),
      indexes: indexes.map((index) => ({
        name: index.name,
        key: index.key,
        unique: Boolean(index.unique),
        partial: index.partialFilterExpression ?? null,
        text: Boolean(index.textIndexVersion) || Object.values(index.key).includes('text'),
        geo: Boolean(index['2dsphereIndexVersion']) || Object.values(index.key).includes('2dsphere'),
      })),
    });
  }
  return out;
}

// Each entry is a real application query; explain() shows which index the planner chose.
const EXPLAIN_QUERIES = {
  open_critical_incidents: {
    description: 'Live queue: open CRITICAL incidents, newest first',
    run: (verbosity) => Incident.find({ status: 'REPORTED', severity: 'CRITICAL' }).sort({ reported_at: -1 }).limit(20).explain(verbosity),
    index: 'status_1_severity_1_reported_at_-1',
  },
  incidents_by_zone: {
    description: 'Zone feed: incidents in one zone, newest first',
    run: (verbosity) => Incident.find({ zone_code: 'Z-05' }).sort({ reported_at: -1 }).limit(20).explain(verbosity),
    index: 'zone_code_1_reported_at_-1',
  },
  incidents_text_search: {
    description: 'Full-text search for "water rescue" in descriptions/needs',
    run: (verbosity) => Incident.find({ $text: { $search: 'water rescue' } }).explain(verbosity),
    index: 'incident_text_search',
  },
  facilities_near_point: {
    description: 'Geo: operational facilities within 3 km of a point',
    run: (verbosity) => Facility.find({ operational: true, location: { $near: { $geometry: { type: 'Point', coordinates: [80.24, 13.02] }, $maxDistance: 3000 } } }).explain(verbosity),
    index: 'location_2dsphere',
  },
  user_login_lookup: {
    description: 'Login: user by unique phone number',
    run: (verbosity) => User.find({ phone: '+999000000097' }).explain(verbosity),
    index: 'phone_1',
  },
  resources_by_facility: {
    description: 'Inventory: stock lines for one facility and category',
    run: async (verbosity) => {
      const facility = await Facility.findOne().select('_id').lean();
      return Resource.find({ facility_id: facility?._id, category: 'WATER' }).explain(verbosity);
    },
    index: 'facility_id_1_category_1',
  },
};

function findStage(plan, names) {
  if (!plan || typeof plan !== 'object') return null;
  if (names.includes(plan.stage)) return plan;
  for (const child of [plan.inputStage, ...(plan.inputStages ?? [])]) {
    const found = findStage(child, names);
    if (found) return found;
  }
  return null;
}

// Normalises explain output. MongoDB returns queryPlanner/executionStats; the summary
// reports the winning stage, the index used, keys and documents examined.
function summariseExplain(raw) {
  const explain = Array.isArray(raw) ? raw[0] : raw;
  const winning = explain?.queryPlanner?.winningPlan;
  if (winning && winning.stage !== undefined) {
    const ix = findStage(winning, ['IXSCAN', 'TEXT_MATCH', 'TEXT', 'GEO_NEAR_2DSPHERE', 'COUNT_SCAN']);
    const coll = findStage(winning, ['COLLSCAN']);
    const stats = explain.executionStats ?? {};
    return {
      engine: 'mongodb',
      winning_stage: winning.stage,
      index_used: ix?.indexName ?? null,
      collection_scan: Boolean(coll),
      keys_examined: stats.totalKeysExamined ?? null,
      docs_examined: stats.totalDocsExamined ?? null,
      docs_returned: stats.nReturned ?? null,
      execution_ms: stats.executionTimeMillis ?? null,
    };
  }
  // Wire-compatible engines (used for local development) return a different plan shape.
  const text = JSON.stringify(explain?.queryPlanner ?? explain ?? {});
  const indexMatch = text.match(/"Index Name":"([^"]+)"/);
  return {
    engine: 'compatible',
    winning_stage: /Index Scan|Bitmap Index Scan/.test(text) ? 'IXSCAN' : (/Seq Scan/.test(text) ? 'COLLSCAN' : 'UNKNOWN'),
    index_used: indexMatch?.[1] ?? null,
    collection_scan: /Seq Scan/.test(text) && !indexMatch,
    keys_examined: null,
    docs_examined: null,
    docs_returned: null,
    execution_ms: (() => { const m = text.match(/"Execution Time":([0-9.]+)/); return m ? Number(m[1]) : null; })(),
  };
}

export function explainQueryNames() {
  return Object.entries(EXPLAIN_QUERIES).map(([name, { description, index }]) => ({ name, description, expected_index: index }));
}

export async function explainQuery(name) {
  const entry = EXPLAIN_QUERIES[name];
  if (!entry) throw new AppError(404, 'Unknown explain query.');
  const raw = await entry.run('executionStats');
  return { name, description: entry.description, expected_index: entry.index, summary: summariseExplain(raw), raw };
}

// Redis operational snapshot: what the fast path currently holds.
export async function redisSnapshot() {
  const { getRedisClient } = await import('../config/redis.js');
  const client = getRedisClient();
  if (!client) return { connected: false };
  const [liveCount, activeAlerts, liveIds] = await Promise.all([
    client.zCard('incident:live'),
    client.zCard('alerts:active'),
    client.zRange('incident:live', 0, 9, { REV: true }),
  ]);
  const live = (await Promise.all(liveIds.map(async (id) => {
    const [summary, ttl] = await Promise.all([client.get(`incident:${id}:summary`), client.ttl(`incident:${id}:summary`)]);
    return summary ? { ...JSON.parse(summary), ttl_seconds: ttl } : { _id: id, ttl_seconds: ttl };
  })));
  const counterKeys = [];
  for await (const key of client.scanIterator({ MATCH: 'facility:*', COUNT: 200 })) {
    counterKeys.push(key);
    if (counterKeys.length >= 12) break;
  }
  const counters = await Promise.all(counterKeys.sort().map(async (key) => ({ key, value: Number(await client.get(key)) })));
  return { connected: true, live_incident_queue: liveCount, active_alerts: activeAlerts, latest_live: live, counters, db_size: await client.dbSize() };
}
