import User from './models/User.js';
import Incident from './models/Incident.js';
import Facility from './models/Facility.js';
import { verifyToken } from './services/tokenService.js';
import { getActiveAlertsForZone } from './services/alertService.js';
import { setResponderPresence } from './services/operationalStateService.js';
import { publishRealtimeEvent, setRealtimeSocketServer, subscribeRealtimeEvents, validZoneCode } from './services/realtimeEventService.js';

export async function canSubscribeToZone(user, zoneCode) {
  if (!validZoneCode(zoneCode)) return false;
  if (['AUTHORITY', 'ADMIN', 'VOLUNTEER', 'RESCUE_LEAD'].includes(user.role)) return true;
  if (user.role === 'CITIZEN') {
    return Boolean(await Incident.exists({ reporter_id: user._id, zone_code: zoneCode }));
  }
  if (user.role === 'FACILITY_MANAGER') {
    return Boolean(await Facility.exists({ 'contact.manager_id': user._id, zone_code: zoneCode }));
  }
  return false;
}

async function sendActiveAlerts(socket, zoneCode) {
  const location = socket.data.alertLocations?.[zoneCode] ?? socket.data.user?.location;
  const alerts = await getActiveAlertsForZone(zoneCode, location);
  for (const alert of alerts) socket.emit('alert:created', alert);
}

export async function configureRealtime(io) {
  setRealtimeSocketServer(io);
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required.'));
      const claims = verifyToken(token);
      const user = await User.findById(claims.sub);
      if (!user || user.role !== claims.role) return next(new Error('Authentication failed.'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('Authentication failed.'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user._id}`);
    socket.data.subscribedZones = [];
    socket.data.alertLocations = {};
    if (['AUTHORITY', 'ADMIN'].includes(user.role)) socket.join(`zone:UNASSIGNED:role:${user.role}`);

    socket.on('zone:subscribe', async (zoneCode, acknowledge = () => {}) => {
      try {
        if (!(await canSubscribeToZone(user, zoneCode))) {
          acknowledge({ error: 'You are not authorized to subscribe to this zone.' });
          return;
        }
        socket.join(`zone:${zoneCode}:role:${user.role}`);
        socket.data.subscribedZones = [...new Set([...socket.data.subscribedZones, zoneCode])];
        await sendActiveAlerts(socket, zoneCode);
        acknowledge({ ok: true, zone_code: zoneCode });
      } catch (error) {
        acknowledge({ error: 'Could not authorize zone subscription.' });
      }
    });

    socket.on('client:location', async (payload, acknowledge = () => {}) => {
      const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
      const zoneCode = payload?.zone_code;
      const coordinates = payload?.location?.coordinates;
      if (!socket.data.subscribedZones.includes(zoneCode) || !(await canSubscribeToZone(user, zoneCode))) {
        respond({ error: 'Subscribe to an authorized zone before sharing location.' });
        return;
      }
      if (payload?.location?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length !== 2
        || !coordinates.every(Number.isFinite) || coordinates[0] < -180 || coordinates[0] > 180
        || coordinates[1] < -90 || coordinates[1] > 90) {
        respond({ error: 'location must be a valid GeoJSON Point.' });
        return;
      }
      socket.data.alertLocations[zoneCode] = { type: 'Point', coordinates: [...coordinates] };
      try { await sendActiveAlerts(socket, zoneCode); }
      catch { /* A Redis read failure must not invalidate the location update. */ }
      respond({ ok: true, zone_code: zoneCode });
    });

    socket.on('responder:presence', async (payload, acknowledge = () => {}) => {
      if (!['VOLUNTEER', 'RESCUE_LEAD'].includes(user.role)) {
        acknowledge({ error: 'Responder role required.' });
        return;
      }
      try {
        const zoneCode = payload?.zone_code;
        if (!(await canSubscribeToZone(user, zoneCode))) {
          acknowledge({ error: 'You are not authorized to publish presence in this zone.' });
          return;
        }
        const available = payload?.available ?? true;
        const presence = await setResponderPresence(user._id, { ...payload, available });
        if (presence) {
          await publishRealtimeEvent('responder:location', zoneCode, {
            responder_id: String(user._id), zone_code: zoneCode,
            location: { type: 'Point', coordinates: [payload.longitude, payload.latitude] },
            updated_at: presence.updated_at,
          });
        }
        await publishRealtimeEvent('responder:status', zoneCode, {
          responder_id: String(user._id), zone_code: zoneCode,
          available: Boolean(available), updated_at: new Date().toISOString(),
        });
        acknowledge({ ok: true, data: presence });
      } catch (error) {
        acknowledge({ error: error.message });
      }
    });
  });

  return subscribeRealtimeEvents(io);
}
