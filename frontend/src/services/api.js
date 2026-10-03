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
};

export const resourcesApi = {
  list: ({ facility_id, page = 1, limit = 100 } = {}) => apiRequest(`/resources${queryString({ facility_id, page, limit })}`),
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
};

export { API_BASE_URL };
