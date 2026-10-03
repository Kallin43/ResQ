import * as service from '../services/analyticsService.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireString } from '../utils/validation.js';

export const incidentsByType = asyncHandler(async (_request, response) => {
  response.json({ data: await service.groupIncidentsBy('type') });
});

export const incidentsBySeverity = asyncHandler(async (_request, response) => {
  response.json({ data: await service.groupIncidentsBy('severity') });
});

export const incidentsByStatus = asyncHandler(async (_request, response) => {
  response.json({ data: await service.groupIncidentsBy('status') });
});

export const incidentsByZone = asyncHandler(async (_request, response) => {
  response.json({ data: await service.groupIncidentsBy('zone_code') });
});

export const resourceAvailability = asyncHandler(async (request, response) => {
  const filters = {};
  if (request.query.facility_id !== undefined) filters.facilityId = requireString(request.query.facility_id, 'facility_id', { max: 100 });
  if (request.query.category !== undefined) filters.category = requireString(request.query.category, 'category', { max: 120 });
  response.json({ data: await service.aggregateResourceAvailability(filters) });
});

export const allocationsByStatus = asyncHandler(async (_request, response) => {
  response.json({ data: await service.groupAllocationsByState() });
});

export const facilityUtilization = asyncHandler(async (_request, response) => {
  response.json({ data: await service.aggregateFacilityUtilization() });
});
