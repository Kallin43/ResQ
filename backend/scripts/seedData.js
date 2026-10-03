import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { classifySeverity } from '../src/services/incidentService.js';

export const SEED_PASSWORD = 'ResQ-Seed-Only-2026!';
export const SEED_DISTRICT = 'Chennai District';

export function seedObjectId(key) {
  return new mongoose.Types.ObjectId(createHash('sha256').update(`resq-phase4:${key}`).digest('hex').slice(0, 24));
}

function randomGenerator(seed = 0x5eed15) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const random = randomGenerator();
const pick = (values) => values[Math.floor(random() * values.length)];
const stableId = (collection, number) => seedObjectId(`${collection}:${String(number).padStart(3, '0')}`);
const round = (number) => Number(number.toFixed(5));

const zones = Array.from({ length: 20 }, (_, index) => {
  const row = Math.floor(index / 5);
  const column = index % 5;
  return {
    code: `Z-${String(index + 1).padStart(2, '0')}`,
    point: {
      type: 'Point',
      coordinates: [round(80.19 + column * 0.021 + random() * 0.009), round(12.96 + row * 0.031 + random() * 0.012)],
    },
  };
});

function pointInZone(zoneIndex) {
  const point = zones[zoneIndex % zones.length].point;
  const longitude = point.coordinates[0] + (random() - 0.5) * 0.008;
  const latitude = point.coordinates[1] + (random() - 0.5) * 0.008;
  return { type: 'Point', coordinates: [round(longitude), round(latitude)] };
}

const teamIds = Array.from({ length: 4 }, (_, index) => seedObjectId(`team:${index + 1}`));
const users = Array.from({ length: 100 }, (_, index) => {
  let role;
  if (index < 70) role = 'CITIZEN';
  else if (index < 88) role = 'VOLUNTEER';
  else if (index < 92) role = 'RESCUE_LEAD';
  else if (index < 96) role = 'FACILITY_MANAGER';
  else role = 'AUTHORITY';
  const teamNumber = (index - 70 + 400) % teamIds.length;
  return {
    _id: stableId('users', index + 1),
    name: `Synthetic ${role.replaceAll('_', ' ')} ${String(index + 1).padStart(3, '0')}`,
    phone: `+999000${String(index + 1).padStart(6, '0')}`,
    role,
    skills: role === 'VOLUNTEER' || role === 'RESCUE_LEAD' ? [pick(['first_aid', 'water_rescue', 'logistics', 'medical_support', 'driving'])] : [],
    location: pointInZone(index % zones.length),
    available: role === 'VOLUNTEER' || role === 'RESCUE_LEAD' ? index % 5 !== 0 : false,
    team_id: role === 'VOLUNTEER' || role === 'RESCUE_LEAD' ? teamIds[teamNumber] : null,
  };
});

const userId = (index) => users[index]._id;
const citizens = users.filter((user) => user.role === 'CITIZEN');
const volunteers = users.filter((user) => user.role === 'VOLUNTEER');
const rescueLeads = users.filter((user) => user.role === 'RESCUE_LEAD');
const facilityManagers = users.filter((user) => user.role === 'FACILITY_MANAGER');
const authorities = users.filter((user) => user.role === 'AUTHORITY');

const facilityKinds = [
  ...Array(9).fill('SHELTER'), ...Array(5).fill('HOSPITAL'),
  ...Array(4).fill('RELIEF_CENTRE'), ...Array(2).fill('DEPOT'),
];
const facilities = Array.from({ length: 20 }, (_, index) => {
  const zoneIndex = index % zones.length;
  const capacity_total = 80 + Math.floor(random() * 321);
  const manager = facilityManagers[index % facilityManagers.length];
  return {
    _id: stableId('facilities', index + 1),
    name: `Synthetic ${facilityKinds[index].replaceAll('_', ' ')} ${String(index + 1).padStart(2, '0')}`,
    kind: facilityKinds[index],
    zone_code: zones[zoneIndex].code,
    location: pointInZone(zoneIndex),
    address: { line1: `Synthetic Block ${String(index + 1).padStart(2, '0')}`, ward: String(zoneIndex + 1), district: SEED_DISTRICT },
    contact: { phone: `+999100${String(index + 1).padStart(6, '0')}`, manager_id: manager._id },
    capacity_total,
    capacity_free: Math.floor(random() * capacity_total),
    services: pick([
      ['FOOD', 'WATER'], ['MEDICAL', 'POWER'], ['FOOD', 'WATER', 'BEDDING'],
      ['MEDICAL', 'WATER'], ['POWER', 'RESCUE_EQUIPMENT'],
    ]),
    operational: index % 9 !== 0,
  };
});

const incidentTypes = ['FLOOD', 'EARTHQUAKE', 'CYCLONE', 'LANDSLIDE', 'FIRE', 'MEDICAL', 'STRUCTURAL', 'OTHER'];
const needsOptions = [['WATER'], ['MEDICAL', 'EVACUATION'], ['FOOD', 'BEDDING'], ['RESCUE', 'URGENT'], ['POWER'], ['SHELTER']];
const incidentStatuses = ['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'DUPLICATE', 'UNREACHABLE'];
const incidentIds = Array.from({ length: 50 }, (_, index) => stableId('incidents', index + 1));
const baseTime = Date.now();
const incidents = Array.from({ length: 50 }, (_, index) => {
  const type = incidentTypes[index % incidentTypes.length];
  const people_affected = pick([1, 3, 8, 18, 32, 75, 140]);
  const needs = pick(needsOptions);
  const status = incidentStatuses[index % incidentStatuses.length];
  const verificationState = status === 'VERIFIED' || status === 'ASSIGNED' || status === 'IN_PROGRESS' || status === 'RESOLVED'
    ? 'VERIFIED'
    : status === 'DUPLICATE' ? 'REJECTED' : 'UNVERIFIED';
  const reported_at = new Date(baseTime - (index + 1) * 31 * 60 * 1000);
  const closed = ['RESOLVED', 'DUPLICATE', 'UNREACHABLE'].includes(status);
  return {
    _id: incidentIds[index],
    reporter_id: citizens[index % citizens.length]._id,
    type,
    severity: classifySeverity({ type, people_affected, needs }),
    status,
    description: `Synthetic ${type.toLowerCase()} report near ${zones[index % zones.length].code}; ${people_affected} people may be affected.`,
    people_affected,
    location: pointInZone(index % zones.length),
    zone_code: zones[index % zones.length].code,
    needs,
    media: [],
    verification: {
      state: verificationState,
      verified_by: verificationState === 'VERIFIED' ? authorities[index % authorities.length]._id : null,
      verified_at: verificationState === 'VERIFIED' ? new Date(reported_at.getTime() + 5 * 60 * 1000) : null,
    },
    duplicate_of: status === 'DUPLICATE' ? incidentIds[(index + 1) % incidentIds.length] : null,
    reported_at,
    closed_at: closed ? new Date(reported_at.getTime() + 45 * 60 * 1000) : null,
  };
});

const resourceCategories = [
  { category: 'FOOD', item: 'meal_packets', unit: 'packets' },
  { category: 'WATER', item: 'drinking_water', unit: 'litres' },
  { category: 'MEDICINE', item: 'first_aid_kits', unit: 'kits' },
  { category: 'BEDDING', item: 'blankets', unit: 'pieces' },
  { category: 'RESCUE_EQUIPMENT', item: 'life_jackets', unit: 'pieces' },
];
const resources = Array.from({ length: 50 }, (_, index) => {
  const stock = resourceCategories[index % resourceCategories.length];
  const quantity = 40 + Math.floor(random() * 461);
  return {
    _id: stableId('resources', index + 1),
    facility_id: facilities[index % facilities.length]._id,
    category: stock.category,
    item: stock.item,
    quantity,
    unit: stock.unit,
    reserved: Math.floor(random() * Math.min(quantity, 31)),
  };
});

const allocationStates = ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'CANCELLED'];
const allocations = Array.from({ length: 20 }, (_, index) => {
  const incident = incidents[index % incidents.length];
  const volunteer = volunteers[index % volunteers.length];
  const resource = resources[(index * 3) % resources.length];
  const facility = facilities[index % facilities.length];
  const state = allocationStates[index % allocationStates.length];
  const steps = allocationStates.slice(0, Math.max(1, allocationStates.indexOf(state) + 1));
  return {
    _id: stableId('allocations', index + 1),
    incident_id: incident._id,
    responder_id: volunteer._id,
    team_id: volunteer.team_id,
    facility_id: facility._id,
    resources: [{ resource_id: resource._id, quantity: Math.min(10, resource.quantity), unit: resource.unit }],
    state,
    route: {
      path_zone_codes: [incident.zone_code, zones[(index + 1) % zones.length].code, facility.zone_code],
      distance_km: Number((1.2 + random() * 18).toFixed(1)),
    },
    eta_minutes: 8 + Math.floor(random() * 53),
    authorised_by: authorities[index % authorities.length]._id,
    timeline: steps.map((step, stepIndex) => ({
      state: step,
      at: new Date(baseTime - (index + 1) * 25 * 60 * 1000 + stepIndex * 3 * 60 * 1000),
      by: stepIndex === 0 ? authorities[index % authorities.length]._id : volunteer._id,
    })),
  };
});

const alerts = Array.from({ length: 10 }, (_, index) => ({
  _id: stableId('alerts', index + 1),
  zone_code: zones[index * 2].code,
  hazard_type: incidentTypes[index % incidentTypes.length],
  message: `Synthetic ${incidentTypes[index % incidentTypes.length].toLowerCase()} advisory for ${zones[index * 2].code}. Follow local response guidance.`,
  centre: pointInZone(index * 2),
  radius_m: 500 + Math.floor(random() * 2501),
  severity: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'][index % 4],
  expires_at: new Date(baseTime + (index + 1) * 60 * 60 * 1000),
}));

export const seedRecords = { users, incidents, facilities, resources, allocations, alerts };
export const seedModels = { users: 'User', incidents: 'Incident', facilities: 'Facility', resources: 'Resource', allocations: 'Allocation', alerts: 'Alert' };

export function allSeedIds() {
  return Object.fromEntries(Object.entries(seedRecords).map(([collection, documents]) => [collection, documents.map(({ _id }) => _id)]));
}
