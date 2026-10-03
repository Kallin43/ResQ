import mongoose from 'mongoose';
import AppError from './AppError.js';

export function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'Request body must be a JSON object.');
  }
}

export function rejectUnknownFields(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new AppError(400, `Unsupported field(s): ${unknown.join(', ')}.`);
}

export function requireString(value, field, { min = 1, max = 5000, optional = false, trim = true } = {}) {
  if (optional && value === undefined) return undefined;
  const normalized = typeof value === 'string' && trim ? value.trim() : value;
  if (typeof normalized !== 'string' || normalized.length < min || normalized.length > max) {
    throw new AppError(400, `${field} must be a string between ${min} and ${max} characters.`);
  }
  return normalized;
}

export function requireNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false, integer = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new AppError(400, `${field} must be a number${integer ? ' (integer)' : ''} between ${min} and ${max}.`);
  }
  return value;
}

export function requireEnum(value, field, values, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (!values.includes(value)) throw new AppError(400, `${field} must be one of: ${values.join(', ')}.`);
  return value;
}

export function requireArray(value, field, { optional = false, itemType = 'string' } = {}) {
  if (optional && value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== itemType)) {
    throw new AppError(400, `${field} must be an array of ${itemType}s.`);
  }
  return value;
}

export function requirePoint(value, field = 'location') {
  if (!value || value.type !== 'Point' || !Array.isArray(value.coordinates) || value.coordinates.length !== 2) {
    throw new AppError(400, `${field} must be a GeoJSON Point with [longitude, latitude] coordinates.`);
  }
  const [longitude, latitude] = value.coordinates;
  if (![longitude, latitude].every(Number.isFinite) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new AppError(400, `${field} coordinates must be valid [longitude, latitude] values.`);
  }
  return { type: 'Point', coordinates: [longitude, latitude] };
}

export function requireId(value, field = 'id') {
  if (!mongoose.isValidObjectId(value)) throw new AppError(400, `${field} must be a valid MongoDB id.`);
  return value;
}

export function pageOptions(query) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 25);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError(400, 'page must be positive and limit must be between 1 and 100.');
  }
  return { page, limit, skip: (page - 1) * limit };
}
