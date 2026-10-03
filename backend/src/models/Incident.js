import mongoose from 'mongoose';
import { GEOJSON_POINT_SCHEMA, INCIDENT_TYPES, SEVERITIES, schemaTimestamps } from './shared.js';

const verificationSchema = new mongoose.Schema({
  state: { type: String, enum: ['UNVERIFIED', 'VERIFIED', 'REJECTED'], default: 'UNVERIFIED' },
  verified_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  verified_at: { type: Date, default: null },
}, { _id: false });

const incidentSchema = new mongoose.Schema({
  reporter_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: INCIDENT_TYPES, required: true },
  severity: { type: String, enum: SEVERITIES, required: true },
  status: {
    type: String,
    enum: ['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'DUPLICATE', 'UNREACHABLE'],
    required: true,
    default: 'REPORTED',
  },
  description: { type: String, maxlength: 1000, default: '' },
  people_affected: { type: Number, min: 0, max: 10000, validate: Number.isInteger, default: 0 },
  location: { type: GEOJSON_POINT_SCHEMA, required: true },
  zone_code: { type: String, trim: true },
  needs: { type: [String], default: [] },
  media: { type: [String], default: [] },
  verification: { type: verificationSchema, default: () => ({}) },
  duplicate_of: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
  reported_at: { type: Date, required: true, default: Date.now },
  closed_at: { type: Date, default: null },
}, { ...schemaTimestamps, collection: 'incidents' });

incidentSchema.index({ location: '2dsphere' });
incidentSchema.index({ status: 1, severity: 1, reported_at: -1 });
incidentSchema.index({ status: 1, reported_at: -1 });
incidentSchema.index({ severity: 1, reported_at: -1 });
incidentSchema.index({ type: 1, reported_at: -1 });
incidentSchema.index({ zone_code: 1, reported_at: -1 });
incidentSchema.index({ reporter_id: 1, reported_at: -1 });

export default mongoose.models.Incident || mongoose.model('Incident', incidentSchema);
