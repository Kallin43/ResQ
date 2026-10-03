import * as service from '../services/resourceService.js';
import asyncHandler from '../utils/asyncHandler.js';
import { pageOptions, rejectUnknownFields, requireId, requireNumber, requireObject, requireString } from '../utils/validation.js';

function resourceFields(body, { partial = false } = {}) {
  const fields = {};
  if (body.facility_id !== undefined || !partial) fields.facility_id = requireId(body.facility_id, 'facility_id');
  if (body.category !== undefined || !partial) fields.category = requireString(body.category, 'category', { max: 100 });
  if (body.item !== undefined || !partial) fields.item = requireString(body.item, 'item', { max: 160 });
  if (body.quantity !== undefined || !partial) fields.quantity = requireNumber(body.quantity, 'quantity');
  if (body.unit !== undefined || !partial) fields.unit = requireString(body.unit, 'unit', { max: 40 });
  if (body.reserved !== undefined) fields.reserved = requireNumber(body.reserved, 'reserved');
  return fields;
}

export const list = asyncHandler(async (request, response) => {
  const pagination = pageOptions(request.query);
  const filters = {};
  if (request.query.facility_id !== undefined) filters.facility_id = requireId(request.query.facility_id, 'facility_id');
  if (request.query.category !== undefined) filters.category = requireString(request.query.category, 'category', { max: 100 });
  response.json(await service.listResources(filters, pagination, request.user));
});

export const create = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['facility_id', 'category', 'item', 'quantity', 'unit', 'reserved']);
  response.status(201).json({ data: await service.createResource(resourceFields(request.body), request.user) });
});

export const update = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['category', 'item', 'quantity', 'unit', 'reserved']);
  response.json({ data: await service.updateResource(requireId(request.params.id), resourceFields(request.body, { partial: true }), request.user) });
});
