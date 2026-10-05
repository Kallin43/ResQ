import * as service from '../services/alertService.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { INCIDENT_TYPES, SEVERITIES } from '../models/shared.js';
import { pageOptions, rejectUnknownFields, requireEnum, requireId, requireObject, requirePoint, requireString, requireNumber } from '../utils/validation.js';
import { validZoneCode } from '../services/realtimeEventService.js';

export const list = asyncHandler(async (request, response) => {
  const pagination = pageOptions(request.query);
  const filters = {};
  if (request.query.zone_code !== undefined) filters.zone_code = requireString(request.query.zone_code, 'zone_code', { max: 80 });
  const hasLongitude = request.query.longitude !== undefined;
  const hasLatitude = request.query.latitude !== undefined;
  if (hasLongitude !== hasLatitude) throw new AppError(400, 'longitude and latitude must be provided together.');
  if (hasLongitude) {
    const longitude = Number(request.query.longitude);
    const latitude = Number(request.query.latitude);
    filters.location = {
      type: 'Point',
      coordinates: [
        requireNumber(longitude, 'longitude', { min: -180, max: 180 }),
        requireNumber(latitude, 'latitude', { min: -90, max: 90 }),
      ],
    };
  }
  response.json(await service.listAlerts(pagination, filters, request.user));
});

export const create = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['zone_code', 'hazard_type', 'message', 'centre', 'radius_m', 'severity', 'expires_at']);
  const expires_at = new Date(request.body.expires_at);
  if (request.body.expires_at === undefined || Number.isNaN(expires_at.getTime())) {
    throw new AppError(400, 'expires_at must be a valid date.');
  }
  const zone_code = requireString(request.body.zone_code, 'zone_code', { max: 80 });
  if (!validZoneCode(zone_code)) throw new AppError(400, 'zone_code contains unsupported characters.');
  const data = {
    zone_code,
    hazard_type: requireEnum(request.body.hazard_type, 'hazard_type', INCIDENT_TYPES),
    message: requireString(request.body.message, 'message', { max: 1000 }),
    centre: requirePoint(request.body.centre, 'centre'),
    radius_m: requireNumber(request.body.radius_m, 'radius_m', { max: 1000000 }),
    severity: requireEnum(request.body.severity, 'severity', SEVERITIES),
    expires_at,
  };
  response.status(201).json({ data: await service.createAlert(data) });
});

export const expire = asyncHandler(async (request, response) => {
  response.json({ data: await service.expireAlert(requireId(request.params.id)) });
});

export const remove = asyncHandler(async (request, response) => {
  response.json({ data: await service.deleteAlert(requireId(request.params.id)) });
});
