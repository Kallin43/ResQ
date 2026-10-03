import AppError from '../utils/AppError.js';

export function notFound(_request, _response, next) {
  next(new AppError(404, 'API route not found.'));
}

export function errorHandler(error, _request, response, _next) {
  if (error?.code === 11000) {
    return response.status(409).json({ error: 'A record with that unique value already exists.' });
  }
  if (error?.name === 'ValidationError') {
    const details = Object.values(error.errors).map(({ path, message }) => ({ field: path, message }));
    return response.status(400).json({ error: 'Validation failed.', details });
  }
  if (error?.name === 'CastError' || error?.name === 'BSONError') {
    return response.status(400).json({ error: 'Invalid identifier or field value.' });
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return response.status(400).json({ error: 'Malformed JSON request body.' });
  }

  const status = error instanceof AppError ? error.statusCode : 500;
  const body = { error: status === 500 ? 'Internal server error.' : error.message };
  if (error instanceof AppError && error.details) body.details = error.details;
  if (status === 500) console.error('Unhandled API error:', error);
  return response.status(status).json(body);
}
