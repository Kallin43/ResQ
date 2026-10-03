import * as service from '../services/facilityService.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { pageOptions, rejectUnknownFields, requireArray, requireEnum, requireId, requireNumber, requireObject, requirePoint, requireString } from '../utils/validation.js';

const KINDS = ['SHELTER', 'HOSPITAL', 'RELIEF_CENTRE', 'DEPOT'];

function facilityFields(body, { partial = false, allowManagerId = false } = {}) {
  const fields = {};
  if (body.name !== undefined || !partial) fields.name = requireString(body.name, 'name', { max: 160 });
  if (body.kind !== undefined || !partial) fields.kind = requireEnum(body.kind, 'kind', KINDS);
  if (body.zone_code !== undefined || !partial) fields.zone_code = requireString(body.zone_code, 'zone_code', { max: 80 });
  if (body.location !== undefined || !partial) fields.location = requirePoint(body.location);
  if (body.capacity_total !== undefined || !partial) fields.capacity_total = requireNumber(body.capacity_total ?? 0, 'capacity_total');
  if (body.capacity_free !== undefined || !partial) fields.capacity_free = requireNumber(body.capacity_free ?? 0, 'capacity_free');
  if (body.operational !== undefined || !partial) {
    fields.operational = body.operational ?? true;
    if (typeof fields.operational !== 'boolean') throw new AppError(400, 'operational must be a boolean.');
  }
  if (body.services !== undefined || (!partial && body.services === undefined)) fields.services = requireArray(body.services ?? [], 'services');
  if (body.address !== undefined) {
    requireObject(body.address);
    fields.address = {};
    for (const key of ['line1', 'ward', 'district']) {
      if (body.address[key] !== undefined) fields.address[key] = requireString(body.address[key], `address.${key}`, { optional: true, max: 250 });
    }
  }
  if (body.contact !== undefined) {
    requireObject(body.contact);
    fields.contact = {};
    if (body.contact.phone !== undefined) fields.contact.phone = requireString(body.contact.phone, 'contact.phone', { max: 30 });
    if (allowManagerId && body.contact.manager_id !== undefined) fields.contact.manager_id = requireId(body.contact.manager_id, 'contact.manager_id');
  }
  return fields;
}

export const list = asyncHandler(async (request, response) => {
  const pagination = pageOptions(request.query);
  const filters = {};
  if (request.query.kind !== undefined) filters.kind = requireEnum(request.query.kind, 'kind', KINDS);
  if (request.query.operational !== undefined) {
    if (!['true', 'false'].includes(request.query.operational)) throw new AppError(400, 'operational must be true or false.');
    filters.operational = request.query.operational === 'true';
  }
  response.json(await service.listFacilities(filters, pagination, request.user));
});

export const get = asyncHandler(async (request, response) => {
  response.json({ data: await service.getFacility(requireId(request.params.id)) });
});

export const create = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['name', 'kind', 'zone_code', 'location', 'capacity_total', 'capacity_free', 'operational', 'services', 'address', 'contact']);
  const data = facilityFields(request.body, { allowManagerId: true });
  response.status(201).json({ data: await service.createFacility(data) });
});

export const update = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['name', 'kind', 'zone_code', 'location', 'capacity_total', 'capacity_free', 'operational', 'services', 'address', 'contact']);
  response.json({ data: await service.updateFacility(requireId(request.params.id), facilityFields(request.body, { partial: true, allowManagerId: true }), request.user) });
});
