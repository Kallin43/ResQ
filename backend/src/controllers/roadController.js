import * as service from '../services/roadService.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { rejectUnknownFields, requireEnum, requireNumber, requireObject, requireString } from '../utils/validation.js';

const ROAD_STATUSES = ['OPEN', 'FLOODED', 'BLOCKED'];

export const list = asyncHandler(async (_request, response) => {
  response.json({ data: await service.listRoads() });
});

export const get = asyncHandler(async (request, response) => {
  const roadId = requireString(request.params.roadId, 'roadId', { max: 500 });
  response.json({ data: await service.getRoad(roadId) });
});

export const create = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['from_zone', 'to_zone', 'status', 'travel_minutes']);
  const fields = {
    from_zone: requireString(request.body.from_zone, 'from_zone', { max: 120 }),
    to_zone: requireString(request.body.to_zone, 'to_zone', { max: 120 }),
    status: requireEnum(request.body.status ?? 'OPEN', 'status', ROAD_STATUSES),
    travel_minutes: requireNumber(request.body.travel_minutes, 'travel_minutes', { min: 1, integer: true }),
  };
  response.status(201).json({ data: await service.createRoad(fields) });
});

export const updateStatus = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['status']);
  const roadId = requireString(request.params.roadId, 'roadId', { max: 500 });
  const status = requireEnum(request.body.status, 'status', ROAD_STATUSES);
  response.json({ data: await service.updateRoadStatus(roadId, status) });
});

export const update = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['status', 'travel_minutes']);
  const changes = {};
  if (request.body.status !== undefined) changes.status = requireEnum(request.body.status, 'status', ROAD_STATUSES);
  if (request.body.travel_minutes !== undefined) changes.travel_minutes = requireNumber(request.body.travel_minutes, 'travel_minutes', { min: 1, integer: true });
  if (!Object.keys(changes).length) throw new AppError(400, 'Provide status and/or travel_minutes.');
  const roadId = requireString(request.params.roadId, 'roadId', { max: 500 });
  response.json({ data: await service.updateRoad(roadId, changes) });
});

export const remove = asyncHandler(async (request, response) => {
  const roadId = requireString(request.params.roadId, 'roadId', { max: 500 });
  response.json({ data: await service.deleteRoad(roadId) });
});
