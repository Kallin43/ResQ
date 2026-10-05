import mongoose from 'mongoose';
import { GEOJSON_POINT_SCHEMA, INCIDENT_TYPES, SEVERITIES, schemaTimestamps } from './shared.js';

const alertSchema = new mongoose.Schema({
  zone_code: { type: String, required: true, trim: true },
  hazard_type: { type: String, enum: INCIDENT_TYPES, required: true },
  message: { type: String, required: true, maxlength: 1000 },
  centre: { type: GEOJSON_POINT_SCHEMA, required: true },
  radius_m: { type: Number, required: true, min: 0 },
  severity: { type: String, enum: SEVERITIES, required: true },
  expires_at: { type: Date, required: true },
}, { ...schemaTimestamps, collection: 'alerts' });

alertSchema.index({ centre: '2dsphere' });
// Expired alerts stay in MongoDB for durable incident history; application queries filter them.
alertSchema.index({ expires_at: 1 });
alertSchema.index({ zone_code: 1, severity: 1, expires_at: -1 });

export default mongoose.models.Alert || mongoose.model('Alert', alertSchema);
