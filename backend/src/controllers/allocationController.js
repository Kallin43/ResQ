import * as service from '../services/allocationService.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { pageOptions, rejectUnknownFields, requireArray, requireId, requireNumber, requireObject, requireString, requireEnum } from '../utils/validation.js';

const STATES = ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'CANCELLED'];

function allocationFields(body, { partial = false } = {}) {
  const fields = {};
  if (body.incident_id !== undefined || !partial) fields.incident_id = requireId(body.incident_id, 'incident_id');
  for (const key of ['responder_id', 'team_id', 'facility_id']) {
    if (body[key] !== undefined) fields[key] = requireId(body[key], key);
  }
  if (body.state !== undefined || !partial) fields.state = requireEnum(body.state ?? 'PROPOSED', 'state', STATES);
  if (body.eta_minutes !== undefined) fields.eta_minutes = requireNumber(body.eta_minutes, 'eta_minutes');
  if (body.resources !== undefined) {
    requireArray(body.resources, 'resources', { itemType: 'object' });
    fields.resources = body.resources.map((item, index) => {
      requireObject(item);
      return {
        resource_id: requireId(item.resource_id, `resources[${index}].resource_id`),
        quantity: requireNumber(item.quantity, `resources[${index}].quantity`),
        unit: requireString(item.unit, `resources[${index}].unit`, { max: 40 }),
      };
    });
  }
  if (body.route !== undefined) {
    requireObject(body.route);
    fields.route = {};
    if (body.route.path_zone_codes !== undefined) fields.route.path_zone_codes = requireArray(body.route.path_zone_codes, 'route.path_zone_codes');
    if (body.route.distance_km !== undefined) fields.route.distance_km = requireNumber(body.route.distance_km, 'route.distance_km');
  }
  return fields;
}

export const list = asyncHandler(async (request, response) => {
  response.json(await service.listAllocations(pageOptions(request.query), request.user));
});

export const get = asyncHandler(async (request, response) => {
  response.json({ data: await service.getAllocation(requireId(request.params.id), request.user) });
});

export const create = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['incident_id', 'responder_id', 'team_id', 'facility_id', 'resources', 'state', 'route', 'eta_minutes']);
  if (request.body.state !== undefined && request.body.state !== 'PROPOSED') {
    throw new AppError(400, 'A confirmed allocation must start in PROPOSED state.');
  }
  response.status(201).json({ data: await service.createAllocation(allocationFields(request.body), request.user) });
});

export const update = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['state', 'eta_minutes', 'route']);
  const fields = allocationFields(request.body, { partial: true });
  if (!Object.keys(fields).length) {
    throw new AppError(400, 'At least one updatable field is required.');
  }
  response.json({ data: await service.updateAllocation(requireId(request.params.id), fields, request.user) });
});
