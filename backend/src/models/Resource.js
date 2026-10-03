import mongoose from 'mongoose';
import { schemaTimestamps } from './shared.js';

const resourceSchema = new mongoose.Schema({
  facility_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility', required: true },
  category: { type: String, required: true, trim: true },
  item: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, trim: true },
  reserved: { type: Number, min: 0, default: 0 },
}, { ...schemaTimestamps, collection: 'resources' });

resourceSchema.index({ facility_id: 1, category: 1 });

export default mongoose.models.Resource || mongoose.model('Resource', resourceSchema);
