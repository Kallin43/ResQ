import jwt from 'jsonwebtoken';
import AppError from '../utils/AppError.js';

function secret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new AppError(500, 'JWT_SECRET must be configured with at least 32 characters.');
  }
  return process.env.JWT_SECRET;
}

export function signToken(user) {
  return jwt.sign({ role: user.role }, secret(), {
    subject: user.id,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
    algorithm: 'HS256',
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, secret(), { algorithms: ['HS256'] });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'Invalid or expired token.');
  }
}
