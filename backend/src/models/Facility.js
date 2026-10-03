import mongoose from 'mongoose';
import { GEOJSON_POINT_SCHEMA, schemaTimestamps } from './shared.js';

const facilitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  kind: { type: String, required: true, enum: ['SHELTER', 'HOSPITAL', 'RELIEF_CENTRE', 'DEPOT'] },
  zone_code: { type: String, required: true, trim: true },
  location: { type: GEOJSON_POINT_SCHEMA, required: true },
  address: {
    line1: String,
    ward: String,
    district: String,
  },
  contact: {
    phone: String,
    manager_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  capacity_total: { type: Number, min: 0, default: 0 },
  capacity_free: { type: Number, min: 0, default: 0 },
  services: { type: [String], default: [] },
  operational: { type: Boolean, default: true },
}, { ...schemaTimestamps, collection: 'facilities' });

facilitySchema.index({ location: '2dsphere' });
facilitySchema.index({ kind: 1, operational: 1 });

export default mongoose.models.Facility || mongoose.model('Facility', facilitySchema);
