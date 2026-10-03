import { getRedisClient } from '../config/redis.js';

const EVENT_ROLES = {
  'incident:created': ['CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  'incident:updated': ['CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  'allocation:created': ['VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  'allocation:updated': ['VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  'facility:updated': ['CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  'resource:updated': ['VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  'alert:created': ['CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  'responder:location': ['VOLUNTEER', 'RESCUE_LEAD', 'AUTHORITY', 'ADMIN'],
  'responder:status': ['VOLUNTEER', 'RESCUE_LEAD', 'AUTHORITY', 'ADMIN'],
};

let socketServer;

export function validZoneCode(zoneCode) {
  return typeof zoneCode === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(zoneCode);
}

function sanitize(eventName, payload) {
  const data = payload?.toObject ? payload.toObject() : payload;
  if (!data || typeof data !== 'object') return data;
  if (eventName.startsWith('incident:')) {
    return Object.fromEntries(['_id', 'type', 'severity', 'status', 'description', 'people_affected', 'location', 'zone_code', 'needs', 'reported_at', 'closed_at'].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  }
  if (eventName.startsWith('allocation:')) {
    return Object.fromEntries(['_id', 'incident_id', 'responder_id', 'team_id', 'facility_id', 'resources', 'state', 'route', 'eta_minutes', 'review_required', 'review_reason', 'timeline', 'created_at', 'updated_at'].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  }
  if (eventName === 'facility:updated') {
    return Object.fromEntries(['_id', 'name', 'kind', 'zone_code', 'location', 'address', 'capacity_total', 'capacity_free', 'services', 'operational', 'updated_at'].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  }
  if (eventName === 'resource:updated') {
    return Object.fromEntries(['_id', 'facility_id', 'category', 'item', 'quantity', 'unit', 'reserved', 'updated_at'].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  }
  if (eventName === 'alert:created') {
    return Object.fromEntries(['_id', 'zone_code', 'hazard_type', 'message', 'centre', 'radius_m', 'severity', 'expires_at', 'created_at'].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  }
  return data;
}

function pointForSocket(socket, zoneCode) {
  const point = socket.data?.alertLocations?.[zoneCode] ?? socket.data?.user?.location;
  return point?.type === 'Point' && Array.isArray(point.coordinates) && point.coordinates.length === 2
    ? point.coordinates.map(Number)
    : null;
}

function isWithinAlertRadius(point, centre, radiusMeters) {
  if (!point || !Array.isArray(centre?.coordinates)) return false;
  const radians = (degrees) => degrees * Math.PI / 180;
  const [longitude, latitude] = point;
  const [centreLongitude, centreLatitude] = centre.coordinates;
  if (![longitude, latitude, centreLongitude, centreLatitude, radiusMeters].every(Number.isFinite)) return false;
  const latitudeDelta = radians(centreLatitude - latitude);
  const longitudeDelta = radians(centreLongitude - longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude)) * Math.cos(radians(centreLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distance <= radiusMeters;
}

async function deliver(envelope) {
  if (!socketServer) return;
  const roles = EVENT_ROLES[envelope.event];
  if (!roles) return;
  const payload = sanitize(envelope.event, envelope.payload);
  if (envelope.event === 'alert:created') {
    if (!Number.isFinite(new Date(payload?.expires_at).getTime()) || new Date(payload.expires_at).getTime() <= Date.now()) return;
    const delivered = new Set();
    for (const role of roles) {
      const room = `zone:${envelope.zoneCode}:role:${role}`;
      const clients = await socketServer.in(room).fetchSockets();
      for (const client of clients) {
        if (delivered.has(client.id)) continue;
        if (!isWithinAlertRadius(pointForSocket(client, envelope.zoneCode), payload.centre, Number(payload.radius_m))) continue;
        client.emit(envelope.event, payload);
        delivered.add(client.id);
      }
    }
    return;
  }
  const zoneRoom = `zone:${envelope.zoneCode}`;
  for (const role of roles) {
    socketServer.to(`${zoneRoom}:role:${role}`).emit(envelope.event, payload);
  }
  for (const userId of envelope.userIds ?? []) {
    socketServer.to(`user:${userId}`).emit(envelope.event, payload);
  }
}

export function setRealtimeSocketServer(io) {
  socketServer = io;
}

export async function publishRealtimeEvent(event, zoneCode, payload, { userIds = [] } = {}) {
  if (!EVENT_ROLES[event]) return false;
  const effectiveZone = validZoneCode(zoneCode) ? zoneCode : 'UNASSIGNED';
  const safePayload = sanitize(event, payload);
  if (event.startsWith('incident:') && !safePayload?.zone_code) safePayload.zone_code = effectiveZone;
  const envelope = { event, zoneCode: effectiveZone, payload: safePayload, userIds: userIds.map(String) };
  const client = getRedisClient();
  if (client) {
    try {
      const subscribers = await client.publish(`channel:zone:${effectiveZone}`, JSON.stringify(envelope));
      if (subscribers > 0) return true;
    } catch (error) {
      console.error('Redis real-time publish failed; using local Socket.IO delivery:', error.message);
    }
  }
  await deliver(envelope);
  return true;
}

export async function subscribeRealtimeEvents(io) {
  const client = getRedisClient();
  if (!client) return null;
  setRealtimeSocketServer(io);
  const subscriber = client.duplicate();
  subscriber.on('error', (error) => console.error('Redis subscriber error:', error.message));
  await subscriber.connect();
  await subscriber.pSubscribe('channel:zone:*', async (message) => {
    try {
      const envelope = JSON.parse(message);
      if (EVENT_ROLES[envelope.event] && validZoneCode(envelope.zoneCode)) {
        await deliver(envelope);
      }
    } catch (error) {
      console.error('Invalid Redis real-time event:', error.message);
    }
  });
  return subscriber;
}
