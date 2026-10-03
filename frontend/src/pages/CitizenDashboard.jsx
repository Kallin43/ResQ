import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext.jsx';
import { alertsApi, API_BASE_URL, incidentsApi } from '../services/api.js';

const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

function sortIncidents(items) {
  return [...items].sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at));
}

function locationText(location) {
  const coordinates = location?.type === 'Point' ? location.coordinates : null;
  if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return 'Location unavailable';
  const [longitude, latitude] = coordinates;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function displayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}

function IncidentCard({ incident }) {
  const severityColor = {
    CRITICAL: 'bg-rose-100 text-rose-800',
    HIGH: 'bg-orange-100 text-orange-800',
    MODERATE: 'bg-amber-100 text-amber-800',
    LOW: 'bg-emerald-100 text-emerald-800',
  }[incident.severity] ?? 'bg-slate-100 text-slate-700';

  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-bold">{incident.type || 'Incident'}</h3><p className="mt-1 text-sm text-slate-500">Reported {displayDate(incident.reported_at)}</p></div>
      <div className="flex gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${severityColor}`}>{incident.severity || 'UNKNOWN'}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{(incident.status || 'UNKNOWN').replaceAll('_', ' ')}</span></div>
    </div>
    <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{incident.description || 'No description provided.'}</p>
    <dl className="mt-5 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">People affected</dt><dd className="mt-1 font-medium">{incident.people_affected ?? 0}</dd></div>
      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zone</dt><dd className="mt-1 font-medium">{incident.zone_code || 'Unassigned'}</dd></div>
      <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current location</dt><dd className="mt-1 font-medium">{locationText(incident.location)}</dd></div>
    </dl>
  </article>;
}

export default function CitizenDashboard() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alertsError, setAlertsError] = useState('');
  const [connection, setConnection] = useState('disconnected');

  const refreshIncidents = useCallback(async () => {
    const firstPage = await incidentsApi.list({ page: 1, limit: 100 });
    const all = [...(firstPage.data ?? [])];
    const pages = firstPage.pagination?.pages ?? 1;
    for (let page = 2; page <= pages; page += 1) {
      const result = await incidentsApi.list({ page, limit: 100 });
      all.push(...(result.data ?? []));
    }
    setIncidents(sortIncidents(all));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setAlertsError('');
    Promise.allSettled([refreshIncidents(), alertsApi.list({ page: 1, limit: 100 })]).then(([incidentResult, alertResult]) => {
      if (!active) return;
      if (incidentResult.status === 'rejected') setError(incidentResult.reason?.message || 'Could not load your incidents.');
      if (alertResult.status === 'fulfilled') setAlerts(alertResult.value.data ?? []);
      else setAlertsError(alertResult.reason?.message || 'Could not load active alerts.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [refreshIncidents]);

  const zones = useMemo(() => [...new Set(incidents.map((incident) => incident.zone_code).filter(Boolean))], [incidents]);
  const zoneKey = zones.join('|');

  useEffect(() => {
    if (!auth.token || zones.length === 0) {
      setConnection('disconnected');
      return undefined;
    }
    let active = true;
    const socket = io(SOCKET_URL, { auth: { token: auth.token } });
    setConnection('connecting');
    socket.on('connect', () => {
      if (!active) return;
      const pending = new Set(zones);
      let denied = false;
      zones.forEach((zone) => socket.emit('zone:subscribe', zone, (result) => {
        if (!active) return;
        if (result?.error) denied = true;
        pending.delete(zone);
        if (pending.size === 0) setConnection(denied ? 'limited' : 'live');
      }));
    });
    socket.on('connect_error', () => { if (active) setConnection('disconnected'); });
    const handleCreated = () => { refreshIncidents().catch((cause) => { if (active) setError(cause.message || 'Could not refresh your incidents.'); }); };
    const handleUpdated = (updated) => {
      if (!updated?._id) return;
      setIncidents((current) => {
        if (!current.some((incident) => incident._id === updated._id)) return current;
        return sortIncidents(current.map((incident) => incident._id === updated._id ? { ...incident, ...updated } : incident));
      });
    };
    socket.on('incident:created', handleCreated);
    socket.on('incident:updated', handleUpdated);
    return () => { active = false; socket.disconnect(); };
  // zoneKey represents the exact set of incident zones; reconnect only when it changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, refreshIncidents, zoneKey]);

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><Link to="/" className="text-sm font-semibold text-teal-800">← ResQ home</Link><p className="mt-4 text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">Citizen dashboard</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Hello, {auth.user?.name || 'there'}</h1><p className="mt-2 text-slate-600">Track your emergency reports and active community alerts.</p></div>
        <div className="flex flex-wrap gap-3"><Link to="/report" className="rounded-lg bg-teal-800 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-900">Report an Emergency</Link><Link to="/facilities" className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-teal-700">Nearby Facilities</Link><button onClick={() => { auth.logout(); navigate('/'); }} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Log out</button></div>
      </header>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Your incidents</h2><p className="mt-1 text-sm text-slate-500">Reports submitted from your account.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${connection === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{connection === 'live' ? 'Live updates on' : connection === 'connecting' ? 'Connecting to live updates' : connection === 'limited' ? 'Some zone updates unavailable' : 'Live updates unavailable'}</span></div>
        {loading && <p role="status" className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Loading your incidents…</p>}
        {!loading && error && <div role="alert" className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800"><p>{error}</p><button onClick={() => { setLoading(true); setError(''); refreshIncidents().catch((cause) => setError(cause.message)).finally(() => setLoading(false)); }} className="mt-3 font-semibold underline">Try again</button></div>}
        {!loading && !error && incidents.length === 0 && <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center"><h3 className="font-semibold">No incidents yet</h3><p className="mt-2 text-sm text-slate-600">When you submit an emergency report, it will appear here.</p><Link to="/report" className="mt-4 inline-flex rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white">Report an Emergency</Link></div>}
        {!loading && !error && incidents.length > 0 && <div className="mt-5 grid gap-4">{incidents.map((incident) => <IncidentCard key={incident._id} incident={incident} />)}</div>}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="text-xl font-bold">Active alerts</h2><p className="mt-1 text-sm text-slate-500">Current alerts returned for your account.</p></div>
        {alertsError && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{alertsError}</p>}
        {!alertsError && alerts.length === 0 && <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">There are no active alerts to show.</p>}
        {alerts.length > 0 && <ul className="mt-4 divide-y divide-slate-100">{alerts.map((alert) => <li key={alert._id} className="py-4 first:pt-0 last:pb-0"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{alert.hazard_type} · {alert.zone_code}</h3><span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">{alert.severity}</span></div><p className="mt-2 text-sm text-slate-700">{alert.message}</p><p className="mt-2 text-xs text-slate-500">Expires {displayDate(alert.expires_at)}</p></li>)}</ul>}
      </section>
    </div>
  </main>;
}
