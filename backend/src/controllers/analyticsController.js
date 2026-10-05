import * as service from '../services/analyticsService.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireNumber, requireString } from '../utils/validation.js';

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

export const dashboard = asyncHandler(async (_request, response) => {
  response.json({ data: await service.dashboardSummary() });
});

export const trend = asyncHandler(async (request, response) => {
  const days = requireNumber(Number(request.query.days ?? 30), 'days', { min: 1, max: 365, integer: true });
  response.json({ data: await service.incidentTrend({ days }) });
});

export const hotspots = asyncHandler(async (_request, response) => {
  response.json({ data: await service.zoneHotspots() });
});

export const nearestFacilities = asyncHandler(async (request, response) => {
  const longitude = requireNumber(Number(request.query.longitude), 'longitude', { min: -180, max: 180 });
  const latitude = requireNumber(Number(request.query.latitude), 'latitude', { min: -90, max: 90 });
  const maxDistanceM = requireNumber(Number(request.query.max_distance_m ?? 10000), 'max_distance_m', { min: 1, max: 200000 });
  const limit = requireNumber(Number(request.query.limit ?? 5), 'limit', { min: 1, max: 20, integer: true });
  const kind = request.query.kind || undefined;
  response.json({ data: await service.nearestFacilities({ longitude, latitude, maxDistanceM, kind, limit }) });
});

export const responseTimes = asyncHandler(async (_request, response) => {
  response.json({ data: await service.allocationResponseTimes() });
});

export const skillCoverage = asyncHandler(async (_request, response) => {
  response.json({ data: await service.responderSkillCoverage() });
});

export const sizeBuckets = asyncHandler(async (_request, response) => {
  response.json({ data: await service.incidentSizeBuckets() });
});

export const lowStock = asyncHandler(async (request, response) => {
  const threshold = requireNumber(Number(request.query.threshold ?? 50), 'threshold', { min: 1, max: 100000 });
  response.json({ data: await service.lowStock({ threshold }) });
});

export const indexes = asyncHandler(async (_request, response) => {
  response.json({ data: await service.listIndexes() });
});

export const explainList = asyncHandler(async (_request, response) => {
  response.json({ data: service.explainQueryNames() });
});

export const explain = asyncHandler(async (request, response) => {
  response.json({ data: await service.explainQuery(requireString(request.params.name, 'name', { max: 80 })) });
});

export const redis = asyncHandler(async (_request, response) => {
  response.json({ data: await service.redisSnapshot() });
});
