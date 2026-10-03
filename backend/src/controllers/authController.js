import * as authService from '../services/authService.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { rejectUnknownFields, requireArray, requireObject, requireString } from '../utils/validation.js';

export const register = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['name', 'phone', 'password', 'role', 'skills']);
  const name = requireString(request.body.name, 'name', { max: 120 });
  const phone = requireString(request.body.phone, 'phone', { min: 7, max: 30 });
  const password = requireString(request.body.password, 'password', { min: 8, max: 128, trim: false });
  const role = request.body.role ?? 'CITIZEN';
  const skills = requireArray(request.body.skills ?? [], 'skills');
  if (request.body.role !== undefined && !['CITIZEN', 'VOLUNTEER'].includes(role)) {
    throw new AppError(400, 'Self-registration is limited to CITIZEN and VOLUNTEER roles.');
  }
  response.status(201).json(await authService.register({ name, phone, password, role, skills }));
});

export const login = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['phone', 'password']);
  const phone = requireString(request.body.phone, 'phone', { min: 7, max: 30 });
  const password = requireString(request.body.password, 'password', { min: 1, max: 128, trim: false });
  response.json(await authService.login({ phone, password }));
});

export const getCurrentUser = asyncHandler(async (request, response) => {
  response.json({ data: await authService.getCurrentUser(request.user._id) });
});

export const updateCurrentUser = asyncHandler(async (request, response) => {
  requireObject(request.body);
  rejectUnknownFields(request.body, ['name', 'phone', 'skills']);
  const changes = {};
  if (request.body.name !== undefined) changes.name = requireString(request.body.name, 'name', { max: 120 });
  if (request.body.phone !== undefined) changes.phone = requireString(request.body.phone, 'phone', { min: 7, max: 30 });
  if (request.body.skills !== undefined) changes.skills = requireArray(request.body.skills, 'skills');
  if (!Object.keys(changes).length) throw new AppError(400, 'Provide name, phone, or skills to update.');
  response.json({ data: await authService.updateCurrentUser(request.user._id, changes) });
});
