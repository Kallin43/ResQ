import * as service from '../services/incidentService.js';
import asyncHandler from '../utils/asyncHandler.js';
import { pageOptions, rejectUnknownFields, requireArray, requireEnum, requireId, requireNumber, requireObject, requirePoint, requireString } from '../utils/validation.js';
import { INCIDENT_TYPES, SEVERITIES } from '../models/shared.js';
import { INCIDENT_STATUSES } from '../services/incidentService.js';

export const create = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['type', 'description', 'people_affected', 'location', 'zone_code', 'needs', 'media']);
  const type = requireEnum(request.body.type, 'type', INCIDENT_TYPES);
  const people_affected = requireNumber(request.body.people_affected ?? 0, 'people_affected', { max: 10000, integer: true });
  const needs = requireArray(request.body.needs ?? [], 'needs');
  const media = requireArray(request.body.media ?? [], 'media');
  const description = requireString(request.body.description ?? '', 'description', { min: 0, max: 1000 });
  const location = requirePoint(request.body.location);
  const zone_code = request.body.zone_code === undefined ? undefined : requireString(request.body.zone_code, 'zone_code', { max: 80 });
  const incident = await service.createIncident({ type, people_affected, needs, media, description, location, zone_code }, request.user);
  response.status(201).json({ data: incident });
});

export const list = asyncHandler(async (request, response) => {
  const pagination = pageOptions(request.query);
  const filters = {};
  if (request.query.type !== undefined) filters.type = requireEnum(request.query.type, 'type', INCIDENT_TYPES);
  if (request.query.severity !== undefined) filters.severity = requireEnum(request.query.severity, 'severity', SEVERITIES);
  if (request.query.status !== undefined) filters.status = requireEnum(request.query.status, 'status', INCIDENT_STATUSES);
  if (request.query.zone_code !== undefined) filters.zone_code = requireString(request.query.zone_code, 'zone_code', { max: 80 });
  filters.pagination = pagination;
  response.json(await service.listIncidents(filters, request.user));
});

export const get = asyncHandler(async (request, response) => {
  const id = requireId(request.params.id);
  response.json({ data: await service.getIncident(id, request.user) });
});

export const updateStatus = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['status']);
  const id = requireId(request.params.id);
  const status = requireEnum(request.body.status, 'status', INCIDENT_STATUSES);
  response.json({ data: await service.updateIncidentStatus(id, status) });
});
