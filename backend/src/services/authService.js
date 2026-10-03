import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import { signToken } from './tokenService.js';

const REGISTERABLE_ROLES = ['CITIZEN', 'VOLUNTEER'];

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    skills: user.skills,
    location: user.location,
    available: user.available,
  };
}

export async function register({ name, phone, password, role = 'CITIZEN', skills = [] }) {
  if (!REGISTERABLE_ROLES.includes(role)) {
    throw new AppError(400, 'Self-registration is limited to CITIZEN and VOLUNTEER roles.');
  }
  const password_hash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, phone, password_hash, role, skills: role === 'VOLUNTEER' ? skills : [] });
  return { user: publicUser(user), token: signToken(user) };
}

export async function login({ phone, password }) {
  const user = await User.findOne({ phone }).select('+password_hash');
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'Phone number or password is incorrect.');
  }
  return { user: publicUser(user), token: signToken(user) };
}

export async function getCurrentUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found.');
  return publicUser(user);
}

export async function updateCurrentUser(userId, changes) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'User not found.');
  if (changes.name !== undefined) user.name = changes.name;
  if (changes.phone !== undefined) user.phone = changes.phone;
  if (changes.skills !== undefined) user.skills = changes.skills;
  await user.save();
  return publicUser(user);
}
