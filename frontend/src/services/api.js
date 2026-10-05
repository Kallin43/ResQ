const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';

export async function apiRequest(path, { method = 'GET', body, headers = {}, ...options } = {}) {
  const token = sessionStorage.getItem('resq_token');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (response.status === 401 && token && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event('resq:unauthorized'));
  }
  if (!response.ok) {
    const message = typeof result?.error === 'string' ? result.error : result?.error?.message;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return result;
}

export const authApi = {
  login: (credentials) => apiRequest('/auth/login', { method: 'POST', body: credentials }),
  register: (details) => apiRequest('/auth/register', { method: 'POST', body: details }),
  currentUser: () => apiRequest('/auth/me'),
  updateCurrentUser: (changes) => apiRequest('/auth/me', { method: 'PATCH', body: changes }),
};

function queryString(params = {}) {
  const values = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return values.length ? `?${new URLSearchParams(values).toString()}` : '';
}

export const incidentsApi = {
  list: (params) => apiRequest(`/incidents${queryString(params)}`),
  get: (id) => apiRequest(`/incidents/${encodeURIComponent(id)}`),
  create: (incident) => apiRequest('/incidents', { method: 'POST', body: incident }),
  update: (id, changes) => apiRequest(`/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  updateStatus: (id, status) => apiRequest(`/incidents/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
  remove: (id) => apiRequest(`/incidents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  search: (q) => apiRequest(`/incidents/search${queryString({ q })}`),
};

export const alertsApi = {
  list: (params) => apiRequest(`/alerts${queryString(params)}`),
  create: (alert) => apiRequest('/alerts', { method: 'POST', body: alert }),
  expire: (id) => apiRequest(`/alerts/${encodeURIComponent(id)}/expire`, { method: 'PATCH', body: {} }),
};

export const allocationsApi = {
  list: (params) => apiRequest(`/allocations${queryString(params)}`),
  get: (id) => apiRequest(`/allocations/${encodeURIComponent(id)}`),
  create: (allocation) => apiRequest('/allocations', { method: 'POST', body: allocation }),
  update: (id, changes) => apiRequest(`/allocations/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
};

export const dispatchApi = {
  candidates: (incidentId) => apiRequest(`/dispatch/candidates/${encodeURIComponent(incidentId)}`),
};

export const facilitiesApi = {
  list: ({ page = 1, limit = 20, kind } = {}) => apiRequest(`/facilities${queryString({ operational: true, page, limit, kind })}`),
  get: (id) => apiRequest(`/facilities/${encodeURIComponent(id)}`),
  listAll: ({ page = 1, limit = 100, kind } = {}) => apiRequest(`/facilities${queryString({ page, limit, kind })}`),
  create: (facility) => apiRequest('/facilities', { method: 'POST', body: facility }),
  update: (id, changes) => apiRequest(`/facilities/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  remove: (id) => apiRequest(`/facilities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  nearby: (params) => apiRequest(`/facilities/nearby${queryString(params)}`),
};

export const resourcesApi = {
  list: ({ facility_id, category, page = 1, limit = 100 } = {}) => apiRequest(`/resources${queryString({ facility_id, category, page, limit })}`),
  create: (resource) => apiRequest('/resources', { method: 'POST', body: resource }),
  update: (id, changes) => apiRequest(`/resources/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }),
  remove: (id) => apiRequest(`/resources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const roadsApi = {
  list: () => apiRequest('/roads'),
  updateStatus: (roadId, status) => apiRequest(`/roads/${encodeURIComponent(roadId)}/status`, { method: 'PATCH', body: { status } }),
};

export const analyticsApi = {
  incidentsByType: () => apiRequest('/analytics/incidents/by-type'),
  incidentsBySeverity: () => apiRequest('/analytics/incidents/by-severity'),
  incidentsByStatus: () => apiRequest('/analytics/incidents/by-status'),
  incidentsByZone: () => apiRequest('/analytics/incidents/by-zone'),
  resourceAvailability: (params = {}) => apiRequest(`/analytics/resources/availability${queryString(params)}`),
  allocationsByStatus: () => apiRequest('/analytics/allocations/by-status'),
  facilityUtilization: () => apiRequest('/analytics/facilities/utilization'),
  dashboard: () => apiRequest('/analytics/dashboard'),
  trend: (days = 30) => apiRequest(`/analytics/incidents/trend${queryString({ days })}`),
  sizeBuckets: () => apiRequest('/analytics/incidents/size-buckets'),
  hotspots: () => apiRequest('/analytics/zones/hotspots'),
  nearestFacilities: (params) => apiRequest(`/analytics/facilities/nearest${queryString(params)}`),
  responseTimes: () => apiRequest('/analytics/allocations/response-times'),
  skills: () => apiRequest('/analytics/responders/skills'),
  lowStock: (threshold = 50) => apiRequest(`/analytics/resources/low-stock${queryString({ threshold })}`),
  indexes: () => apiRequest('/analytics/indexes'),
  explainQueries: () => apiRequest('/analytics/explain'),
  explain: (name) => apiRequest(`/analytics/explain/${encodeURIComponent(name)}`),
  redis: () => apiRequest('/analytics/redis'),
};

export { API_BASE_URL };
