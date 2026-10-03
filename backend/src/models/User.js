import mongoose from 'mongoose';
import { GEOJSON_POINT_SCHEMA, schemaTimestamps } from './shared.js';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, required: true, trim: true },
  password_hash: { type: String, required: true, select: false },
  role: {
    type: String,
    required: true,
    enum: ['CITIZEN', 'VOLUNTEER', 'RESCUE_LEAD', 'FACILITY_MANAGER', 'AUTHORITY', 'ADMIN'],
  },
  skills: { type: [String], default: [] },
  location: { type: GEOJSON_POINT_SCHEMA },
  available: { type: Boolean, default: false },
  team_id: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { ...schemaTimestamps, collection: 'users' });

userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ location: '2dsphere' });
userSchema.index({ role: 1 });

export default mongoose.models.User || mongoose.model('User', userSchema);
