// Review 2 checks: full CRUD lifecycle, search/geo endpoints, aggregation and
// index endpoints. Start the API first (npm run dev), then: npm run test:crud
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { Facility, Incident, Resource, User } from '../src/models/index.js';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000';
const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cleanupIds = { users: [], incidents: [], facilities: [], resources: [] };
let checks = 0;

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  checks += 1;
  console.log(`PASS ${message}`);
}

async function call(method, path, { token, body, expected }) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  check(response.status === expected, `${method} ${path} -> ${response.status} (expected ${expected})`);
  return data;
}

async function fixtureUser(role, password) {
  const user = await User.create({ name: `CRUD ${role}`, phone: `+98${runId}${role.length}`, password_hash: await bcrypt.hash(password, 4), role });
  cleanupIds.users.push(user._id);
  const { token } = await call('POST', '/api/auth/login', { body: { phone: user.phone, password }, expected: 200 });
  return token;
}

try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  const authority = await fixtureUser('AUTHORITY', 'Authority-crud-2026');
  const citizen = await fixtureUser('CITIZEN', 'Citizen-crud-2026');

  // Incidents: create -> read -> update -> search -> delete
  const point = { type: 'Point', coordinates: [80.2401, 13.0201] };
  const { data: incident } = await call('POST', '/api/incidents', {
    token: citizen, expected: 201,
    body: { type: 'FLOOD', description: 'CRUD test kayak rescue needed', people_affected: 4, location: point, zone_code: 'Z-09', needs: ['RESCUE'] },
  });
  cleanupIds.incidents.push(incident._id);
  await call('GET', `/api/incidents/${incident._id}`, { token: citizen, expected: 200 });
  const { data: edited } = await call('PATCH', `/api/incidents/${incident._id}`, { token: citizen, expected: 200, body: { people_affected: 120, description: 'CRUD test kayak rescue needed urgently' } });
  check(edited.people_affected === 120 && edited.severity === 'CRITICAL', 'Incident update re-classifies severity from the new values.');
  const { data: hits } = await call('GET', '/api/incidents/search?q=kayak', { token: authority, expected: 200 });
  check(hits.some((hit) => hit._id === incident._id), 'Text index search finds the updated incident.');
  await call('PATCH', `/api/incidents/${incident._id}/status`, { token: authority, expected: 200, body: { status: 'VERIFIED' } });
  await call('PATCH', `/api/incidents/${incident._id}`, { token: citizen, expected: 409, body: { description: 'too late' } });
  await call('DELETE', `/api/incidents/${incident._id}`, { token: citizen, expected: 403 });
  await call('DELETE', `/api/incidents/${incident._id}`, { token: authority, expected: 200 });
  check(!(await Incident.exists({ _id: incident._id })), 'Deleted incident is removed from MongoDB.');
  await call('GET', `/api/incidents/${incident._id}`, { token: authority, expected: 404 });

  // Facilities + resources with cascade delete
  const { data: facility } = await call('POST', '/api/facilities', {
    token: authority, expected: 201,
    body: { name: `CRUD Test Shelter ${runId}`, kind: 'SHELTER', zone_code: 'Z-09', location: point, capacity_total: 50, capacity_free: 40, services: ['beds', 'meals'] },
  });
  cleanupIds.facilities.push(facility._id);
  const { data: nearby } = await call('GET', '/api/facilities/nearby?longitude=80.2401&latitude=13.0201&max_distance_m=500', { token: citizen, expected: 200 });
  check(nearby[0]?._id === facility._id, '2dsphere $near query returns the new facility first.');
  const { data: resource } = await call('POST', '/api/resources', { token: authority, expected: 201, body: { facility_id: facility._id, category: 'WATER', item: 'crud_cans', quantity: 10, unit: 'cans' } });
  cleanupIds.resources.push(resource._id);
  await call('PATCH', `/api/resources/${resource._id}`, { token: authority, expected: 200, body: { reserved: 2 } });
  await call('DELETE', `/api/resources/${resource._id}`, { token: authority, expected: 409 });
  await call('PATCH', `/api/resources/${resource._id}`, { token: authority, expected: 200, body: { reserved: 0 } });
  await call('DELETE', `/api/resources/${resource._id}`, { token: authority, expected: 200 });
  const { data: second } = await call('POST', '/api/resources', { token: authority, expected: 201, body: { facility_id: facility._id, category: 'FOOD', item: 'crud_meals', quantity: 5, unit: 'packets' } });
  cleanupIds.resources.push(second._id);
  const { data: removed } = await call('DELETE', `/api/facilities/${facility._id}`, { token: authority, expected: 200 });
  check(removed.resources_deleted === 1 && !(await Resource.exists({ _id: second._id })), 'Facility delete cascades to its inventory lines.');
  check(!(await Facility.exists({ _id: facility._id })), 'Deleted facility is removed from MongoDB.');

  // Aggregations and indexes
  for (const path of ['dashboard', 'incidents/trend?days=30', 'incidents/size-buckets', 'zones/hotspots', 'facilities/nearest?longitude=80.24&latitude=13.02',
    'allocations/response-times', 'responders/skills', 'resources/low-stock', 'resources/availability', 'facilities/utilization', 'indexes', 'redis']) {
    await call('GET', `/api/analytics/${path}`, { token: authority, expected: 200 });
  }
  await call('GET', '/api/analytics/dashboard', { token: citizen, expected: 403 });
  const { data: plan } = await call('GET', '/api/analytics/explain/user_login_lookup', { token: authority, expected: 200 });
  check(plan.summary.index_used === 'phone_1', 'Login lookup uses the unique phone index.');
  console.log(`\nAll ${checks} CRUD / index / aggregation checks passed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await Incident.deleteMany({ _id: { $in: cleanupIds.incidents } });
  await Resource.deleteMany({ _id: { $in: cleanupIds.resources } });
  await Facility.deleteMany({ _id: { $in: cleanupIds.facilities } });
  await User.deleteMany({ _id: { $in: cleanupIds.users } });
  await mongoose.disconnect();
}
