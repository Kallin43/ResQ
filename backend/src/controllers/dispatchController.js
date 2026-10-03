import * as service from '../services/dispatchService.js';
import asyncHandler from '../utils/asyncHandler.js';
import { requireId } from '../utils/validation.js';

export const candidates = asyncHandler(async (request, response) => {
  const incidentId = requireId(request.params.incidentId, 'incidentId');
  const data = await service.findDispatchCandidates(incidentId);
  response.json({ data });
});
