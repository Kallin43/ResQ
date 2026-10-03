import User from '../models/User.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { verifyToken } from '../services/tokenService.js';

export const authenticate = asyncHandler(async (request, _response, next) => {
  const authorization = request.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AppError(401, 'Bearer token required.');
  const claims = verifyToken(match[1]);

  const user = await User.findById(claims.sub);
  if (!user) throw new AppError(401, 'Account is no longer available.');
  if (claims.role !== user.role) throw new AppError(401, 'Account permissions changed. Please sign in again.');
  request.user = user;
  next();
});

export function authorize(...allowedRoles) {
  return (request, _response, next) => {
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      return next(new AppError(403, 'You do not have permission to perform this action.'));
    }
    next();
  };
}
