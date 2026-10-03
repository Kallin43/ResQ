import mongoose from 'mongoose';
import { schemaTimestamps } from './shared.js';

const roadSchema = new mongoose.Schema({
  road_id: { type: String, required: true, trim: true },
  from_zone: { type: String, required: true, trim: true },
  to_zone: { type: String, required: true, trim: true },
  status: { type: String, enum: ['OPEN', 'FLOODED', 'BLOCKED'], required: true, default: 'OPEN' },
  travel_minutes: { type: Number, required: true, min: 1, validate: Number.isInteger },
}, { ...schemaTimestamps, collection: 'roads' });

roadSchema.index({ road_id: 1 }, { unique: true });
roadSchema.index({ from_zone: 1, to_zone: 1 }, { unique: true });
roadSchema.index({ from_zone: 1, status: 1 });
roadSchema.index({ to_zone: 1, status: 1 });

export default mongoose.models.Road || mongoose.model('Road', roadSchema);
