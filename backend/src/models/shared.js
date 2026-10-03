import mongoose from 'mongoose';

export const GEOJSON_POINT_SCHEMA = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Point'],
    required: true,
    default: 'Point',
  },
  coordinates: {
    type: [Number],
    required: true,
    validate: {
      validator: (coordinates) =>
        coordinates.length === 2 &&
        coordinates.every(Number.isFinite) &&
        coordinates[0] >= -180 &&
        coordinates[0] <= 180 &&
        coordinates[1] >= -90 &&
        coordinates[1] <= 90,
      message: 'GeoJSON coordinates must be [longitude, latitude].',
    },
  },
}, { _id: false });

export const INCIDENT_TYPES = [
  'FLOOD', 'EARTHQUAKE', 'CYCLONE', 'LANDSLIDE', 'FIRE', 'MEDICAL', 'STRUCTURAL', 'OTHER',
];
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];

export const schemaTimestamps = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
};
