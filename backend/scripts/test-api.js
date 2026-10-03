import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { createClient } from 'redis';
import { Alert, Allocation, Facility, Incident, Resource, Road, User } from '../src/models/index.js';
import { roadIdFor } from '../src/utils/roadId.js';
import { rebuildNeo4jFromMongo } from './seedGraph.js';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000';
const runId = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
const inserted = { users: [], incidents: [], facilities: [], resources: [], allocations: [], alerts: [], roads: [] };
let checks = 0;
let connected = false;
const skipped = [];
const socketClients = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
  console.log(`PASS ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(method, path, { token, body, expected } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  assert(response.status === expected, `${method} ${path}: expected ${expected}, got ${response.status}.`);
  checks += 1;
  console.log(`PASS ${method} ${path} -> ${response.status}`);
  return data;
}

async function cleanup() {
  for (const [Model, ids] of [
    [Allocation, inserted.allocations], [Alert, inserted.alerts], [Road, inserted.roads], [Resource, inserted.resources],
    [Incident, inserted.incidents], [Facility, inserted.facilities], [User, inserted.users],
  ]) {
    if (ids.length) await Model.deleteMany({ _id: { $in: ids } });
  }
}

async function socketConnect(token) {
  const socketUrl = `${apiBase.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
  const ws = new WebSocket(socketUrl);
  const socket = { ws, frames: [], waiters: [] };
  ws.addEventListener('message', ({ data }) => {
    const frame = String(data);
    if (frame === '2') { ws.send('3'); return; }
    if (frame.startsWith('0')) { ws.send(`40${JSON.stringify({ token })}`); return; }
    for (const waiter of [...socket.waiters]) {
      if (waiter.matches(frame)) {
        socket.waiters.splice(socket.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
        return;
      }
    }
    socket.frames.push(frame);
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket.IO handshake timed out.')), 5000);
    socket.waiters.push({
      matches: (frame) => frame.startsWith('40'),
      resolve: () => { clearTimeout(timeout); resolve(); },
      timer: timeout,
    });
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Socket.IO connection failed.')); }, { once: true });
  });
  socketClients.push(socket);
  return socket;
}

function socketEmit(socket, event, ...args) {
  socket.ws.send(`42${JSON.stringify([event, ...args])}`);
}

function socketWait(socket, event, timeoutMs = 5000) {
  const matches = (frame) => {
    if (!frame.startsWith('42')) return false;
    try { return JSON.parse(frame.slice(2))[0] === event; } catch { return false; }
  };
  const index = socket.frames.findIndex(matches);
  if (index >= 0) return Promise.resolve(JSON.parse(socket.frames.splice(index, 1)[0].slice(2)));
  return new Promise((resolve, reject) => {
    const waiter = {
      matches,
      resolve: (frame) => resolve(JSON.parse(frame.slice(2))),
      timer: setTimeout(() => {
        socket.waiters.splice(socket.waiters.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for Socket.IO ${event}.`));
      }, timeoutMs),
    };
    socket.waiters.push(waiter);
  });
}

async function assertNoSocketEvent(socket, event, durationMs = 300) {
  const matches = (frame) => {
    if (!frame.startsWith('42')) return false;
    try { return JSON.parse(frame.slice(2))[0] === event; } catch { return false; }
  };
  assert(!socket.frames.some(matches), `Unexpected Socket.IO ${event} was already received.`);
  const received = await new Promise((resolve) => {
    const waiter = { matches, resolve: () => resolve(true), timer: setTimeout(() => resolve(false), durationMs) };
    socket.waiters.push(waiter);
  });
  assert(!received, `Unexpected Socket.IO ${event} was received.`);
}

async function isRedisAvailable() {
  if (!process.env.REDIS_URL) return false;
  const client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 1500, reconnectStrategy: false } });
  client.on('error', () => {});
  try { await client.connect(); await client.ping(); return true; }
  catch { return false; }
  finally { if (client.isOpen) await client.quit(); }
}

try {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be configured to run API integration checks.');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  connected = true;

  const health = await request('GET', '/api/health', { expected: 200 });
  assert(health.database === 'connected', 'Health endpoint did not report database connected.');

  const credentials = { name: 'ResQ API verification', phone: `+991${runId}`, password: 'ResQ-test-password-2026' };
  const registration = await request('POST', '/api/auth/register', { body: credentials, expected: 201 });
  const citizen = registration.user;
  inserted.users.push(citizen.id);
  assert(!('password_hash' in citizen), 'Registration response exposed password_hash.');
  const citizenToken = (await request('POST', '/api/auth/login', {
    body: { phone: credentials.phone, password: credentials.password }, expected: 200,
  })).token;
  const currentUserResponse = await request('GET', '/api/auth/me', { token: citizenToken, expected: 200 });
  check(currentUserResponse.data.name === credentials.name && currentUserResponse.data.role === 'CITIZEN', 'Authenticated user read returns only the current user profile.');
  const updatedProfile = await request('PATCH', '/api/auth/me', { token: citizenToken, body: { name: 'ResQ API verification updated' }, expected: 200 });
  check(updatedProfile.data.name === 'ResQ API verification updated' && updatedProfile.data.role === 'CITIZEN', 'Current user can update allowed profile fields without changing role.');
  await request('PATCH', '/api/auth/me', { token: citizenToken, body: { role: 'ADMIN' }, expected: 400 });
  await request('POST', '/api/auth/register', {
    body: { ...credentials, phone: `+992${runId}`, role: 'AUTHORITY' }, expected: 400,
  });
  await request('POST', '/api/auth/login', {
    body: { phone: credentials.phone, password: 'incorrect-password' }, expected: 401,
  });

  const authority = await User.create({
    name: 'ResQ API authority fixture', phone: `+993${runId}`,
    password_hash: await bcrypt.hash('Authority-test-password-2026', 4), role: 'AUTHORITY',
  });
  inserted.users.push(authority.id);
  const authorityToken = (await request('POST', '/api/auth/login', {
    body: { phone: authority.phone, password: 'Authority-test-password-2026' }, expected: 200,
  })).token;

  const admin = await User.create({
    name: 'ResQ API admin fixture', phone: `+995${runId}`,
    password_hash: await bcrypt.hash('Admin-test-password-2026', 4), role: 'ADMIN',
  });
  inserted.users.push(admin.id);
  const adminToken = (await request('POST', '/api/auth/login', {
    body: { phone: admin.phone, password: 'Admin-test-password-2026' }, expected: 200,
  })).token;

  const responder = await User.create({
    name: 'ResQ API responder fixture', phone: `+994${runId}`,
    password_hash: await bcrypt.hash('Responder-test-password-2026', 4), role: 'VOLUNTEER', available: true,
    location: { type: 'Point', coordinates: [80.221, 12.989] },
  });
  inserted.users.push(responder.id);
  const responderToken = (await request('POST', '/api/auth/login', {
    body: { phone: responder.phone, password: 'Responder-test-password-2026' }, expected: 200,
  })).token;
  const authoritySocket = await socketConnect(authorityToken);
  socketEmit(authoritySocket, 'zone:subscribe', 'TEST-ZONE');
  const responderSocket = await socketConnect(responderToken);
  socketEmit(responderSocket, 'zone:subscribe', 'TEST-ZONE');

  await request('GET', '/api/incidents', { expected: 401 });
  const incidentResponse = await request('POST', '/api/incidents', {
    token: citizenToken,
    body: {
      type: 'FLOOD', description: 'API verification incident', people_affected: 6,
      location: { type: 'Point', coordinates: [80.221, 12.989] },
      zone_code: 'TEST-ZONE', needs: ['WATER'], media: [],
    },
    expected: 201,
  });
  const incidentId = incidentResponse.data._id;
  inserted.incidents.push(incidentId);
  assert(incidentResponse.data.severity === 'MODERATE', 'Severity classification returned an unexpected value.');
  const persistedIncident = await Incident.findById(incidentId).lean();
  check(Boolean(persistedIncident && persistedIncident.reporter_id.equals(citizen.id)), 'MongoDB persisted the reported incident and reporter.');
  const incidentSocketEvent = await socketWait(authoritySocket, 'incident:created');
  check(incidentSocketEvent[1]._id === incidentId, 'Socket.IO delivered the incident to the subscribed authority zone.');
  await request('GET', '/api/incidents', { token: citizenToken, expected: 200 });
  await request('GET', `/api/incidents/${incidentId}`, { token: citizenToken, expected: 200 });
  await request('GET', '/api/incidents', { token: adminToken, expected: 200 });
  await request('GET', `/api/incidents/${incidentId}`, { token: adminToken, expected: 200 });
  await request('PATCH', `/api/incidents/${incidentId}/status`, {
    token: citizenToken, body: { status: 'VERIFIED' }, expected: 403,
  });
  await request('PATCH', `/api/incidents/${incidentId}/status`, {
    token: authorityToken, body: { status: 'VERIFIED' }, expected: 200,
  });
  await request('PATCH', `/api/incidents/${incidentId}/status`, {
    token: adminToken, body: { status: 'VERIFIED' }, expected: 200,
  });

  await request('GET', '/api/facilities', { token: citizenToken, expected: 200 });
  const facilityResponse = await request('POST', '/api/facilities', {
    token: authorityToken,
    body: {
      name: 'ResQ API verification facility', kind: 'SHELTER', zone_code: 'TEST-ZONE',
      location: { type: 'Point', coordinates: [80.222, 12.99] }, capacity_total: 20, capacity_free: 10,
    },
    expected: 201,
  });
  const facilityId = facilityResponse.data._id;
  inserted.facilities.push(facilityId);
  await request('GET', `/api/facilities/${facilityId}`, { token: citizenToken, expected: 200 });
  await request('PATCH', `/api/facilities/${facilityId}`, {
    token: authorityToken, body: { capacity_free: 9 }, expected: 200,
  });
  await request('POST', '/api/facilities', { token: citizenToken, body: {}, expected: 403 });

  await request('GET', '/api/resources', { token: citizenToken, expected: 200 });
  const resourceResponse = await request('POST', '/api/resources', {
    token: authorityToken,
    body: { facility_id: facilityId, category: 'WATER', item: 'API verification', quantity: 10, unit: 'litres' },
    expected: 201,
  });
  const resourceId = resourceResponse.data._id;
  inserted.resources.push(resourceId);
  await request('PATCH', `/api/resources/${resourceId}`, {
    token: authorityToken, body: { quantity: 8 }, expected: 200,
  });

  let dispatchPassed = false;
  for (let attempt = 0; attempt < 8 && !dispatchPassed; attempt += 1) {
    try {
      await request('GET', `/api/dispatch/candidates/${incidentId}`, {
        token: authorityToken,
        expected: 200,
      });
      dispatchPassed = true;
    } catch (error) {
      if (!process.env.NEO4J_URI || !String(error.message).includes('expected 200, got 503')) throw error;
      if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!dispatchPassed) {
    console.log('INFO Dispatch graph was still synchronizing; rebuilding from MongoDB and retrying once.');
    await rebuildNeo4jFromMongo();
    await request('GET', `/api/dispatch/candidates/${incidentId}`, { token: authorityToken, expected: 200 });
  }

  await request('GET', '/api/allocations', { token: authorityToken, expected: 200 });
  const redisAvailable = await isRedisAvailable();
  let allocationId;
  const allocationBody = {
    incident_id: incidentId, responder_id: responder.id, facility_id: facilityId,
    resources: [{ resource_id: resourceId, quantity: 2, unit: 'litres' }],
    route: { path_zone_codes: ['TEST-ZONE', 'TEST-ROAD-A', 'TEST-ROAD-B'] },
  };
  if (redisAvailable) {
    const allocationResponse = await request('POST', '/api/allocations', {
      token: authorityToken, body: allocationBody, expected: 201,
    });
    allocationId = allocationResponse.data._id;
    const allocationCreatedEvent = await socketWait(responderSocket, 'allocation:created');
    check(allocationCreatedEvent[1]._id === allocationId, 'Socket.IO notified the assigned responder about the confirmed allocation.');
  } else {
    await request('POST', '/api/allocations', { token: authorityToken, body: allocationBody, expected: 503 });
    skipped.push('Redis-backed reservation and persistence-compensation workflow (Redis unavailable).');
    console.log('SKIP Redis-backed reservation workflow: Redis is unavailable.');
  }
  if (!allocationId) {
    const allocation = await Allocation.create({
      ...allocationBody, state: 'PROPOSED', authorised_by: authority.id,
      timeline: [{ state: 'PROPOSED', at: new Date(), by: authority.id }],
    });
    allocationId = String(allocation._id);
    console.log('INFO Created a temporary MongoDB allocation fixture to continue responder and road-state API checks without Redis.');
  }
  inserted.allocations.push(allocationId);
  const persistedAllocation = await Allocation.findById(allocationId).lean();
  check(Boolean(persistedAllocation && persistedAllocation.timeline[0]?.state === 'PROPOSED'), 'MongoDB persisted allocation and its initial timeline.');
  await request('GET', `/api/allocations/${allocationId}`, { token: authorityToken, expected: 200 });

  const roadResponse = await request('POST', '/api/roads', {
    token: authorityToken,
    body: { from_zone: 'TEST-ROAD-A', to_zone: 'TEST-ROAD-B', status: 'OPEN', travel_minutes: 4 },
    expected: 201,
  });
  const roadId = roadResponse.data.road_id;
  const road = await Road.findOne({ road_id: roadId });
  assert(road && road.from_zone === 'TEST-ROAD-A' && road.to_zone === 'TEST-ROAD-B' && roadId === roadIdFor(road.from_zone, road.to_zone), 'Road API persisted canonical MongoDB road fields.');
  inserted.roads.push(road.id);
  await request('GET', `/api/roads/${roadId}`, { token: authorityToken, expected: 200 });
  await request('PATCH', `/api/roads/${roadId}`, { token: authorityToken, body: { travel_minutes: 5 }, expected: 200 });
  await request('PATCH', `/api/roads/${roadId}/status`, { token: authorityToken, body: { status: 'BLOCKED' }, expected: 200 });
  if (redisAvailable) {
    const roadNotice = await socketWait(responderSocket, 'allocation:updated');
    check(roadNotice[1]._id === allocationId && roadNotice[1].review_required, 'Socket.IO notified the responder that road closure requires allocation review.');
  }
  const roadAfterClosure = await Road.findById(road.id).lean();
  const allocationForReview = await Allocation.findById(allocationId).lean();
  check(roadAfterClosure.status === 'BLOCKED', 'MongoDB persisted road closure status.');
  check(allocationForReview.review_required === true, 'Road closure marked the active allocation for review.');
  await request('PATCH', `/api/roads/${roadId}/status`, { token: citizenToken, body: { status: 'OPEN' }, expected: 403 });

  await request('PATCH', `/api/allocations/${allocationId}`, {
    token: responderToken, body: { state: 'ACCEPTED' }, expected: 200,
  });
  if (redisAvailable) {
    const statusNotice = await socketWait(responderSocket, 'responder:status');
    check(statusNotice[1].allocation_id === allocationId && statusNotice[1].status === 'ACCEPTED', 'Socket.IO notified the responder of the authority-confirmed workflow status.');
  }
  await request('PATCH', `/api/allocations/${allocationId}`, {
    token: responderToken, body: { state: 'EN_ROUTE' }, expected: 200,
  });
  await request('PATCH', `/api/allocations/${allocationId}`, {
    token: responderToken, body: { state: 'ON_SCENE' }, expected: 200,
  });
  await request('PATCH', `/api/allocations/${allocationId}`, {
    token: responderToken, body: { state: 'COMPLETED' }, expected: 200,
  });
  const completedAllocation = await Allocation.findById(allocationId).lean();
  check(completedAllocation.timeline.length === 5 && completedAllocation.timeline.every((entry) => entry.by && entry.at), 'Responder state transitions persisted a complete actor/timestamp timeline.');

  const outsideSocket = await socketConnect(authorityToken);
  socketEmit(outsideSocket, 'zone:subscribe', 'TEST-ZONE');
  await new Promise((resolve) => setTimeout(resolve, 150));
  socketEmit(authoritySocket, 'client:location', { zone_code: 'TEST-ZONE', location: { type: 'Point', coordinates: [80.221, 12.989] } });
  socketEmit(outsideSocket, 'client:location', { zone_code: 'TEST-ZONE', location: { type: 'Point', coordinates: [81.2, 13.5] } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const alertResponse = await request('POST', '/api/alerts', {
    token: authorityToken,
    body: {
      zone_code: 'TEST-ZONE', hazard_type: 'FLOOD', message: 'API verification alert',
      centre: { type: 'Point', coordinates: [80.221, 12.989] }, radius_m: 500, severity: 'LOW',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    },
    expected: 201,
  });
  inserted.alerts.push(alertResponse.data._id);
  const persistedAlert = await Alert.findById(alertResponse.data._id).lean();
  check(Boolean(persistedAlert), 'MongoDB persisted the durable zone alert.');
  const receivedAlert = await socketWait(authoritySocket, 'alert:created');
  check(receivedAlert[1]._id === alertResponse.data._id, 'Socket.IO delivered an active alert to a client inside its radius.');
  await assertNoSocketEvent(outsideSocket, 'alert:created');
  check(true, 'Socket.IO withheld the alert from a client outside its radius.');
  const alertList = await request('GET', '/api/alerts?zone_code=TEST-ZONE&longitude=80.221&latitude=12.989', { token: citizenToken, expected: 200 });
  check(alertList.data.some((alert) => alert._id === alertResponse.data._id), 'GET /api/alerts returned an unexpired alert inside the requested radius.');
  await request('PATCH', `/api/alerts/${alertResponse.data._id}/expire`, { token: authorityToken, expected: 200 });
  const expiredAlert = await Alert.findById(alertResponse.data._id).lean();
  check(expiredAlert.expires_at <= new Date(), 'Authority expiration preserves the alert record while ending active delivery.');
  const activeAlertsAfterExpiry = await request('GET', '/api/alerts?zone_code=TEST-ZONE', { token: citizenToken, expected: 200 });
  check(!activeAlertsAfterExpiry.data.some((alert) => alert._id === alertResponse.data._id), 'Expired alert is no longer returned by the active alerts API.');

  const aggregationCases = [
    ['/api/analytics/incidents/by-type', await Incident.countDocuments(), 'incident type aggregation'],
    ['/api/analytics/incidents/by-severity', await Incident.countDocuments(), 'incident severity aggregation'],
    ['/api/analytics/incidents/by-status', await Incident.countDocuments(), 'incident status aggregation'],
    ['/api/analytics/incidents/by-zone', await Incident.countDocuments({ zone_code: { $type: 'string', $ne: '' } }), 'incident zone aggregation'],
  ];
  for (const [path, expectedTotal, label] of aggregationCases) {
    const result = await request('GET', path, { token: authorityToken, expected: 200 });
    assert(Array.isArray(result.data) && result.data.length > 0, `${label} returned no grouped records.`);
    assert(result.data.every((row) => row._id && Number.isInteger(row.count) && row.count > 0), `${label} response rows had an invalid shape.`);
    check(result.data.reduce((sum, row) => sum + row.count, 0) === expectedTotal, `${label} grouped counts match MongoDB documents.`);
  }

  const resourceAnalytics = await request('GET', '/api/analytics/resources/availability', { token: authorityToken, expected: 200 });
  const resourceDocuments = await Resource.aggregate([{ $group: { _id: null, items: { $sum: 1 }, total: { $sum: '$quantity' }, reserved: { $sum: '$reserved' } } }]);
  assert(Array.isArray(resourceAnalytics.data) && resourceAnalytics.data.length > 0, 'Resource availability aggregation returned no facilities/categories.');
  check(resourceAnalytics.data.every((row) => row.facility_id && row.facility_name && row.facility_kind && row.zone_code && row.category && Number.isInteger(row.item_count)), 'Resource availability response includes facility, category, and quantity fields.');
  check(resourceAnalytics.data.reduce((sum, row) => sum + row.item_count, 0) === resourceDocuments[0].items, 'Resource availability item counts match MongoDB.');
  check(resourceAnalytics.data.reduce((sum, row) => sum + row.total_quantity, 0) === resourceDocuments[0].total, 'Resource availability quantities match MongoDB.');
  const fixtureStock = resourceAnalytics.data.find((row) => row.facility_id === String(facilityId) && row.category === 'WATER');
  check(Boolean(fixtureStock && fixtureStock.available_quantity === fixtureStock.total_quantity - fixtureStock.reserved_quantity), 'Resource availability includes the synthetic facility and correct available quantity.');

  const allocationAnalytics = await request('GET', '/api/analytics/allocations/by-status', { token: authorityToken, expected: 200 });
  check(allocationAnalytics.data.length > 0 && allocationAnalytics.data.every((row) => row._id && Number.isInteger(row.count) && row.count > 0), 'Allocation aggregation returns valid status/count rows.');
  check(allocationAnalytics.data.reduce((sum, row) => sum + row.count, 0) === await Allocation.countDocuments(), 'Allocation status counts match MongoDB documents.');
  const utilizationAnalytics = await request('GET', '/api/analytics/facilities/utilization', { token: authorityToken, expected: 200 });
  check(utilizationAnalytics.data.every((row) => row._id && row.name && row.kind && typeof row.operational === 'boolean' && Number.isFinite(row.capacity_utilization_percent) && Number.isFinite(row.resource_available_quantity)), 'Facility utilization response has consistent capacity/resource fields.');
  check(utilizationAnalytics.data.length === await Facility.countDocuments(), 'Facility utilization returns one aggregated row per facility.');
  const fixtureUtilization = utilizationAnalytics.data.find((row) => row._id === String(facilityId));
  const fixtureFacility = await Facility.findById(facilityId).lean();
  check(Boolean(fixtureUtilization && fixtureUtilization.capacity_free === fixtureFacility.capacity_free && fixtureUtilization.capacity_used === fixtureFacility.capacity_total - fixtureFacility.capacity_free), 'Facility utilization capacity values match the synthetic facility.');
  await request('GET', '/api/analytics/incidents/by-type', { token: citizenToken, expected: 403 });

  await request('POST', '/api/alerts', { token: citizenToken, body: {}, expected: 403 });
  await request('GET', '/api/roads', { token: citizenToken, expected: 403 });
  await request('DELETE', `/api/roads/${roadId}`, { token: authorityToken, expected: 200 });
  for (const socket of socketClients) socket.ws.close();
  console.log(`API integration checks passed: ${checks}.`);
  if (skipped.length) console.log(`Integration workflows skipped: ${skipped.length}.`);
} catch (error) {
  console.error(`API integration checks failed after ${checks} checks: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (connected) {
    for (const socket of socketClients) socket.ws.close();
    await cleanup();
    if (process.env.NEO4J_URI) {
      try { await rebuildNeo4jFromMongo(); }
      catch (error) {
        console.error('Could not restore the canonical Neo4j projection after API fixtures:', error.message);
        process.exitCode = 1;
      }
    }
    await mongoose.disconnect();
    console.log('Temporary integration data cleaned up.');
  }
}
