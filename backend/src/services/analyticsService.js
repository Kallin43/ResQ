import mongoose from 'mongoose';
import { Allocation, Facility, Incident, Resource } from '../models/index.js';
import AppError from '../utils/AppError.js';

const incidentGroupFields = new Set(['type', 'severity', 'status', 'zone_code']);

export async function groupIncidentsBy(field) {
  if (!incidentGroupFields.has(field)) throw new AppError(400, 'Unsupported incident grouping.');
  const match = field === 'zone_code' ? { zone_code: { $type: 'string', $ne: '' } } : {};
  return Incident.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
}

export async function aggregateResourceAvailability({ facilityId, category } = {}) {
  const match = {};
  if (facilityId !== undefined) {
    if (!mongoose.isValidObjectId(facilityId)) throw new AppError(400, 'facility_id must be a valid MongoDB ID.');
    match.facility_id = new mongoose.Types.ObjectId(facilityId);
  }
  if (category !== undefined) match.category = category;

  return Resource.aggregate([
    { $match: match },
    {
      $group: {
        _id: { facility_id: '$facility_id', category: '$category' },
        item_count: { $sum: 1 },
        total_quantity: { $sum: '$quantity' },
        reserved_quantity: { $sum: '$reserved' },
        available_quantity: { $sum: { $max: [0, { $subtract: ['$quantity', '$reserved'] }] } },
      },
    },
    { $lookup: { from: 'facilities', localField: '_id.facility_id', foreignField: '_id', as: 'facility' } },
    { $unwind: '$facility' },
    {
      $project: {
        _id: 0,
        facility_id: '$_id.facility_id',
        facility_name: '$facility.name',
        facility_kind: '$facility.kind',
        zone_code: '$facility.zone_code',
        category: '$_id.category',
        item_count: 1,
        total_quantity: 1,
        reserved_quantity: 1,
        available_quantity: 1,
      },
    },
    { $sort: { facility_name: 1, category: 1 } },
  ]);
}

export async function groupAllocationsByState() {
  return Allocation.aggregate([
    { $group: { _id: '$state', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
}

export async function aggregateFacilityUtilization() {
  return Facility.aggregate([
    {
      $lookup: {
        from: 'resources',
        localField: '_id',
        foreignField: 'facility_id',
        pipeline: [{
          $group: {
            _id: null,
            item_count: { $sum: 1 },
            total_quantity: { $sum: '$quantity' },
            reserved_quantity: { $sum: '$reserved' },
            available_quantity: { $sum: { $max: [0, { $subtract: ['$quantity', '$reserved'] }] } },
          },
        }],
        as: 'resource_summary',
      },
    },
    { $unwind: { path: '$resource_summary', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        name: 1,
        kind: 1,
        zone_code: 1,
        operational: 1,
        capacity_total: 1,
        capacity_free: 1,
        capacity_used: { $max: [0, { $subtract: ['$capacity_total', '$capacity_free'] }] },
        capacity_utilization_percent: {
          $cond: [
            { $gt: ['$capacity_total', 0] },
            { $round: [{ $multiply: [{ $divide: [{ $max: [0, { $subtract: ['$capacity_total', '$capacity_free'] }] }, '$capacity_total'] }, 100] }, 1] },
            0,
          ],
        },
        resource_item_count: { $ifNull: ['$resource_summary.item_count', 0] },
        resource_total_quantity: { $ifNull: ['$resource_summary.total_quantity', 0] },
        resource_reserved_quantity: { $ifNull: ['$resource_summary.reserved_quantity', 0] },
        resource_available_quantity: { $ifNull: ['$resource_summary.available_quantity', 0] },
      },
    },
    { $sort: { name: 1 } },
  ]);
}
