import mongoose from 'mongoose';
import { schemaTimestamps } from './shared.js';

const allocationResourceSchema = new mongoose.Schema({
  resource_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, trim: true },
}, { _id: false });

const timelineEntrySchema = new mongoose.Schema({
  state: { type: String, enum: ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'CANCELLED'], required: true },
  at: { type: Date, required: true, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const allocationSchema = new mongoose.Schema({
  incident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true },
  responder_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  team_id: { type: mongoose.Schema.Types.ObjectId },
  facility_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility' },
  resources: { type: [allocationResourceSchema], default: [] },
  state: {
    type: String,
    enum: ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'CANCELLED'],
    required: true,
    default: 'PROPOSED',
  },
  route: {
    path_zone_codes: { type: [String], default: [] },
    distance_km: { type: Number, min: 0 },
  },
  eta_minutes: { type: Number, min: 0 },
  review_required: { type: Boolean, default: false },
  review_reason: { type: String, trim: true, maxlength: 500, default: '' },
  authorised_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  timeline: { type: [timelineEntrySchema], default: [] },
}, { ...schemaTimestamps, collection: 'allocations' });

allocationSchema.index({ incident_id: 1, state: 1 });
allocationSchema.index({ responder_id: 1, state: 1 });

export default mongoose.models.Allocation || mongoose.model('Allocation', allocationSchema);
