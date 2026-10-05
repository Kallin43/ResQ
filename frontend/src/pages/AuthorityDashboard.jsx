import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext.jsx';
import { API_BASE_URL, alertsApi, allocationsApi, analyticsApi, dispatchApi, facilitiesApi, incidentsApi, resourcesApi, roadsApi } from '../services/api.js';

const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');
const INCIDENT_TYPES = ['FLOOD', 'EARTHQUAKE', 'CYCLONE', 'LANDSLIDE', 'FIRE', 'MEDICAL', 'STRUCTURAL', 'OTHER'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];
const ROAD_STATES = ['OPEN', 'BLOCKED', 'FLOODED'];
const ACTIVE_STATES = ['PROPOSED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];
const payload = (value) => value?.data ?? value;
const records = (value) => Array.isArray(payload(value)) ? payload(value) : [];
const unwrap = (value) => value?.data?.data ?? value?.data ?? value;
const incidentIsActive = (incident) => !['RESOLVED', 'DUPLICATE', 'UNREACHABLE'].includes(incident.status);
const pointText = (point) => point?.type === 'Point' && Array.isArray(point.coordinates)
  ? `${point.coordinates[1]}, ${point.coordinates[0]}` : 'Location unavailable';
const pretty = (value) => value ? String(value).replaceAll('_', ' ') : '—';
const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const btn = 'rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

async function fetchAllPages(api) {
  const first = await api({ page: 1, limit: 100 });
  const firstData = records(first);
  const pages = first?.pagination?.pages ?? 1;
  const later = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, index) => api({ page: index + 2, limit: 100 })));
  return [...firstData, ...later.flatMap(records)];
}

function Info({ label, children }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-800">{children ?? '—'}</dd></div>;
}

function IncidentDetail({ incident, allocations, refreshKey, reloadAllocations, setNotice }) {
  const [candidates, setCandidates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [facilityDetails, setFacilityDetails] = useState({});
  const [resourceDetails, setResourceDetails] = useState({});
  const [selectedResponder, setSelectedResponder] = useState('');
  const [selectedFacility, setSelectedFacility] = useState('');
  const [selectedResource, setSelectedResource] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [actionBusy, setActionBusy] = useState(false);
  const [details, setDetails] = useState(incident);
  const [detailError, setDetailError] = useState('');
  const incidentId = incident._id ?? incident.id;

  const loadCandidates = useCallback(async () => {
    setBusy(true); setError(''); setCandidates(null);
    try {
      const result = unwrap(await dispatchApi.candidates(incidentId));
      const next = { facilities: result?.facilities ?? [], responders: result?.responders ?? [] };
      setCandidates(next);
      const facilityResults = await Promise.all(next.facilities.map(async (item) => {
        try { return [item.facilityId, unwrap(await facilitiesApi.get(item.facilityId))]; } catch { return [item.facilityId, null]; }
      }));
      setFacilityDetails(Object.fromEntries(facilityResults.filter(([, value]) => value)));
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }, [incidentId]);

  useEffect(() => {
    setDetails(incident);
    incidentsApi.get(incidentId).then((result) => setDetails(unwrap(result))).catch((cause) => setDetailError(cause.message));
    reloadAllocations().catch(() => {});
  }, [incident, incidentId, reloadAllocations]);
  useEffect(() => { loadCandidates(); }, [loadCandidates, refreshKey]);

  const facilityCandidate = candidates?.facilities.find((item) => item.facilityId === selectedFacility);
  const available = facilityCandidate?.availableResources ?? [];
  const selectedAvailability = available.find((item, index) => `${item.category}:${item.item}:${index}` === selectedResource);

  useEffect(() => {
    if (!selectedFacility) { setResourceDetails({}); return; }
    resourcesApi.list({ facility_id: selectedFacility, limit: 100 }).then((result) => {
      const rows = records(result);
      setResourceDetails(Object.fromEntries(rows.map((resource) => [`${resource.category}:${resource.item}`, resource])));
      if (!selectedResource && available.length) {
        const firstAvailable = available.find((item) => rows.some((resource) => resource.category === item.category && resource.item === item.item && resource.quantity - resource.reserved > 0));
        if (firstAvailable) setSelectedResource(`${firstAvailable.category}:${firstAvailable.item}:${available.indexOf(firstAvailable)}`);
      }
    }).catch((cause) => setError(`Could not load facility stock: ${cause.message}`));
  }, [selectedFacility]);

  async function createAllocation(event) {
    event.preventDefault();
    const resource = selectedAvailability && resourceDetails[`${selectedAvailability.category}:${selectedAvailability.item}`];
    if (!selectedResponder || !facilityCandidate) { setError('Choose a reachable responder and facility.'); return; }
    if (selectedAvailability && (!resource?._id || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > Math.min(selectedAvailability.quantity, resource.quantity - resource.reserved))) {
      setError('Choose a valid quantity within the currently available stock.'); return;
    }
    setActionBusy(true); setError('');
    try {
      await allocationsApi.create({
        incident_id: incidentId,
        responder_id: selectedResponder,
        ...(candidates.responders.find((item) => item.responderId === selectedResponder)?.teamId ? { team_id: candidates.responders.find((item) => item.responderId === selectedResponder).teamId } : {}),
        facility_id: facilityCandidate.facilityId,
        resources: resource ? [{ resource_id: resource._id, quantity: Number(quantity), unit: resource.unit }] : [],
        eta_minutes: facilityCandidate.travelTime,
      });
      await reloadAllocations();
      setNotice('Allocation confirmed and submitted as PROPOSED.');
    } catch (cause) { setError(cause.message); }
    finally { setActionBusy(false); }
  }

  async function cancelAllocation(id) {
    setActionBusy(true); setError('');
    try { await allocationsApi.update(id, { state: 'CANCELLED' }); await reloadAllocations(); setNotice('Allocation cancelled.'); }
    catch (cause) { setError(cause.message); }
    finally { setActionBusy(false); }
  }

  const incidentAllocations = allocations.filter((item) => String(item.incident_id?._id ?? item.incident_id) === String(incidentId));
  const location = details.location;

  return <section className={`${card} p-5`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-wider text-teal-700">Incident details</p><h2 className="mt-1 text-xl font-bold">{pretty(details.type)} <span className="text-slate-400">·</span> {pretty(details.severity)}</h2><p className="mt-1 text-sm text-slate-500">{details._id}</p></div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{pretty(details.status)}</span>
    </div>
    {detailError && <p className="mt-3 text-sm text-amber-800">Showing incident list data; detail request failed: {detailError}</p>}
    <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Info label="Description">{details.description || 'No description'}</Info><Info label="People affected">{details.people_affected}</Info><Info label="Zone">{details.zone_code || 'Unassigned'}</Info>
      <Info label="Reported">{details.reported_at ? new Date(details.reported_at).toLocaleString() : '—'}</Info><Info label="Location">{pointText(location)}</Info><Info label="Verification">{details.verification?.state}</Info>
      <Info label="Needs">{details.needs?.length ? details.needs.join(', ') : 'None listed'}</Info><Info label="Media">{details.media?.length ? details.media.join(', ') : 'None'}</Info><Info label="Closed">{details.closed_at ? new Date(details.closed_at).toLocaleString() : 'Still open'}</Info>
    </dl>
    <p className="mt-4 text-sm text-slate-600">Reporter: <span className="font-medium">{details.reporter_id?._id ?? details.reporter_id ?? 'Not supplied'}</span>{details.duplicate_of && <> · Duplicate of {String(details.duplicate_of)}</>}</p>

    <div className="mt-7 border-t border-slate-200 pt-5">
      <h3 className="font-bold">Allocations and lifecycle</h3>
      {incidentAllocations.length === 0 ? <p className="mt-3 text-sm text-slate-500">No allocations yet.</p> : <div className="mt-3 space-y-3">{incidentAllocations.map((allocation) => <article key={allocation._id} className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-semibold">{pretty(allocation.state)}</span><span className="ml-2 text-xs text-slate-500">Responder {String(allocation.responder_id?._id ?? allocation.responder_id ?? '—')}</span></div>{allocation.review_required && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Road review required</span>}</div>
        <p className="mt-1 text-xs text-slate-600">Facility {String(allocation.facility_id?._id ?? allocation.facility_id ?? '—')} · ETA {allocation.eta_minutes ?? '—'} min</p>
        {allocation.review_reason && <p className="mt-2 text-sm text-amber-900">{allocation.review_reason}</p>}
        <ol className="mt-3 flex flex-wrap gap-2">{(allocation.timeline ?? []).map((entry, index) => <li key={`${entry.state}-${index}`} className="rounded-lg bg-slate-50 px-2 py-1 text-xs"><b>{pretty(entry.state)}</b><span className="text-slate-500"> · {entry.at ? new Date(entry.at).toLocaleString() : 'time unavailable'} · {String(entry.by?._id ?? entry.by ?? 'user')}</span></li>)}</ol>
        {ACTIVE_STATES.includes(allocation.state) && <button type="button" disabled={actionBusy} onClick={() => cancelAllocation(allocation._id)} className={`${btn} mt-3 bg-rose-50 text-rose-800 hover:bg-rose-100`}>Cancel allocation</button>}
      </article>)}</div>}
      <p className="mt-3 text-xs text-slate-500">Responders advance PROPOSED → ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED. Authority accounts can cancel an active allocation; lifecycle changes are made by responders.</p>
    </div>

    <div className="mt-7 border-t border-slate-200 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Reachable facilities and responders</h3><p className="mt-1 text-xs text-slate-500">Reachability uses current OPEN roads and the backend’s live availability.</p></div><button type="button" onClick={loadCandidates} disabled={busy} className={`${btn} border border-slate-300 text-slate-700`}>{busy ? 'Refreshing…' : 'Refresh candidates'}</button></div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {busy && <p className="mt-4 text-sm text-slate-500">Finding reachable resources…</p>}
      {!busy && candidates && candidates.facilities.length === 0 && candidates.responders.length === 0 && <p className="mt-4 text-sm text-slate-500">No reachable responders or facilities were returned.</p>}
      {candidates && <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-4"><h4 className="font-semibold">Facilities</h4>{candidates.facilities.length ? <ul className="mt-3 space-y-2">{candidates.facilities.map((facility) => <li key={facility.facilityId} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex justify-between gap-3"><b>{facility.facilityName}</b><span className="text-sm font-semibold text-teal-800">{facility.travelTime} min</span></div><p className="mt-1 text-xs text-slate-500">{facilityDetails[facility.facilityId]?.kind || facilityDetails[facility.facilityId]?.type || 'Facility type unavailable'} · Zone {facility.zone}</p><p className="mt-2 text-sm">{facility.availableResources?.length ? facility.availableResources.map((resource) => `${resource.item} (${resource.quantity} ${resource.unit})`).join(' · ') : 'No matching stock reported'}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No reachable facilities.</p>}</div>
        <div className="rounded-xl bg-slate-50 p-4"><h4 className="font-semibold">Responders</h4>{candidates.responders.length ? <ul className="mt-3 space-y-2">{candidates.responders.map((responder) => <li key={responder.responderId} className="flex justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><span><b>{pretty(responder.role)}</b><span className="block text-xs text-slate-500">ID {responder.responderId} · {responder.teamId ? `Team ${responder.teamId} · ` : ''}Zone {responder.zone}</span></span><span className="text-sm font-semibold text-teal-800">{responder.travelTime} min</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No reachable responders.</p>}</div>
      </div>}
      {candidates?.facilities?.length > 0 && <form onSubmit={createAllocation} className="mt-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
        <h4 className="font-semibold">Confirm resource allocation</h4><p className="mt-1 text-xs text-slate-600">The backend atomically reserves the selected capacity and records a PROPOSED allocation.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-semibold text-slate-700">Responder<select required value={selectedResponder} onChange={(event) => setSelectedResponder(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="">Select responder</option>{candidates.responders.map((item) => <option key={item.responderId} value={item.responderId}>{item.role} · {item.responderId.slice(-6)}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-700">Facility<select required value={selectedFacility} onChange={(event) => { setSelectedFacility(event.target.value); setSelectedResource(''); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="">Select facility</option>{candidates.facilities.map((item) => <option key={item.facilityId} value={item.facilityId}>{item.facilityName} · {item.travelTime} min</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-700">Resource<select value={selectedResource} onChange={(event) => setSelectedResource(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="">Facility capacity only</option>{available.map((item, index) => <option key={`${item.category}:${item.item}:${index}`} value={`${item.category}:${item.item}:${index}`}>{item.item} · {item.quantity} {item.unit}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-700">Quantity<input type="number" min="1" max={selectedAvailability?.quantity ?? 1} disabled={!selectedAvailability} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" /></label>
        </div>
        {selectedFacility && available.length === 0 && <p className="mt-2 text-xs text-slate-600">This reachable facility has no matching resource stock. The backend may still enforce its capacity requirements.</p>}
        <button type="submit" disabled={actionBusy || !candidates.responders.length || !selectedFacility} className={`${btn} mt-4 bg-teal-700 text-white hover:bg-teal-800`}>{actionBusy ? 'Submitting…' : 'Confirm allocation'}</button>
      </form>}
      <p className="mt-3 text-xs text-slate-500">The reachability API does not return route segments or per-route road status. Review the road list below for current network status.</p>
    </div>
  </section>;
}

function RoadsPanel({ reloadSignal, onChanged, setNotice }) {
  const [roads, setRoads] = useState([]); const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [saving, setSaving] = useState('');
  const load = useCallback(async () => { setBusy(true); setError(''); try { setRoads(records(await roadsApi.list())); } catch (cause) { setError(cause.message); } finally { setBusy(false); } }, []);
  useEffect(() => { load(); }, [load, reloadSignal]);
  async function changeStatus(road, status) {
    setSaving(road.road_id); setError('');
    try { const result = unwrap(await roadsApi.updateStatus(road.road_id, status)); await load(); onChanged(); setNotice(`Road ${road.road_id} updated to ${status}${result?.affectedAllocations?.length ? `; ${result.affectedAllocations.length} allocation(s) flagged for review` : ''}.`); }
    catch (cause) { setError(cause.message); }
    finally { setSaving(''); }
  }
  return <section className={`${card} p-5`}><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Road network</h2><p className="mt-1 text-sm text-slate-500">Status changes refresh reachability and flag affected allocations.</p></div><button onClick={load} className={`${btn} border border-slate-300`}>Refresh</button></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{busy ? <p className="mt-4 text-sm text-slate-500">Loading roads…</p> : !roads.length ? <p className="mt-4 text-sm text-slate-500">No road records returned.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-2">Road ID</th><th className="pb-2">From</th><th className="pb-2">To</th><th className="pb-2">Travel</th><th className="pb-2">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{roads.map((road) => <tr key={road.road_id}><td className="py-3 font-medium">{road.road_id}</td><td>{road.from_zone}</td><td>{road.to_zone}</td><td>{road.travel_minutes} min</td><td><select aria-label={`Status for road ${road.road_id}`} disabled={saving === road.road_id} value={road.status} onChange={(event) => changeStatus(road, event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1">{ROAD_STATES.map((state) => <option key={state}>{state}</option>)}</select></td></tr>)}</tbody></table></div>}</section>;
}

function AlertsPanel({ setNotice, refreshSignal }) {
  const [alerts, setAlerts] = useState([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [submitting, setSubmitting] = useState(false); const [expiringId, setExpiringId] = useState('');
  const [form, setForm] = useState({ zone_code: '', hazard_type: 'FLOOD', message: '', latitude: '', longitude: '', radius_m: '1000', severity: 'HIGH', expires_at: '' });
  const load = useCallback(async () => { setLoading(true); setError(''); try { setAlerts(records(await alertsApi.list({ page: 1, limit: 100 }))); } catch (cause) { setError(cause.message); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load, refreshSignal]);
  async function submit(event) {
    event.preventDefault(); setSubmitting(true); setError('');
    const latitude = Number(form.latitude); const longitude = Number(form.longitude); const expiry = new Date(form.expires_at);
    if (!form.zone_code.trim() || !form.message.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(Number(form.radius_m)) || Number(form.radius_m) <= 0 || Number.isNaN(expiry.getTime()) || expiry <= new Date()) {
      setError('Enter a zone, message, valid center coordinates, positive radius, and future expiry time.'); setSubmitting(false); return;
    }
    try { await alertsApi.create({ zone_code: form.zone_code.trim(), hazard_type: form.hazard_type, message: form.message.trim(), centre: { type: 'Point', coordinates: [longitude, latitude] }, radius_m: Number(form.radius_m), severity: form.severity, expires_at: expiry.toISOString() }); await load(); setNotice('Alert created and delivered through the active alert service.'); setForm((current) => ({ ...current, message: '' })); }
    catch (cause) { setError(cause.message); }
    finally { setSubmitting(false); }
  }
  async function expire(alert) {
    setExpiringId(alert._id); setError('');
    try { await alertsApi.expire(alert._id); await load(); setNotice(`Alert ${String(alert._id).slice(-6)} expired.`); }
    catch (cause) { setError(cause.message); }
    finally { setExpiringId(''); }
  }
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return <section className={`${card} p-5`}><div><h2 className="text-lg font-bold">Zone alerts</h2><p className="mt-1 text-sm text-slate-500">Alerts require a zone and GeoJSON center in longitude, latitude order.</p></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-semibold">Zone code<input required value={form.zone_code} onChange={set('zone_code')} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <label className="text-xs font-semibold">Hazard<select value={form.hazard_type} onChange={set('hazard_type')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">{INCIDENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
      <label className="text-xs font-semibold">Severity<select value={form.severity} onChange={set('severity')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">{SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}</select></label>
      <label className="text-xs font-semibold">Radius (meters)<input type="number" min="1" value={form.radius_m} onChange={set('radius_m')} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <label className="text-xs font-semibold">Latitude<input type="number" step="any" min="-90" max="90" required value={form.latitude} onChange={set('latitude')} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <label className="text-xs font-semibold">Longitude<input type="number" step="any" min="-180" max="180" required value={form.longitude} onChange={set('longitude')} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <label className="text-xs font-semibold">Expiry<input type="datetime-local" required value={form.expires_at} onChange={set('expires_at')} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <label className="text-xs font-semibold sm:col-span-2 xl:col-span-3">Message<textarea required maxLength="1000" value={form.message} onChange={set('message')} rows="2" className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <div className="flex items-end"><button disabled={submitting} className={`${btn} w-full bg-teal-700 text-white hover:bg-teal-800`}>{submitting ? 'Creating…' : 'Create alert'}</button></div>
    </form>
    <div className="mt-6 border-t border-slate-200 pt-4"><h3 className="font-semibold">Active alerts</h3>{loading ? <p className="mt-2 text-sm text-slate-500">Loading alerts…</p> : !alerts.length ? <p className="mt-2 text-sm text-slate-500">No active alerts.</p> : <div className="mt-3 grid gap-3 md:grid-cols-2">{alerts.map((alert) => <article key={alert._id} className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex justify-between gap-2"><b>{pretty(alert.hazard_type)} · {pretty(alert.severity)}</b><span className="text-xs">Zone {alert.zone_code}</span></div><p className="mt-1 text-sm">{alert.message}</p><p className="mt-1 text-xs text-slate-600">Radius {alert.radius_m} m · Expires {new Date(alert.expires_at).toLocaleString()}</p><button type="button" disabled={expiringId === alert._id} onClick={() => expire(alert)} className={`${btn} mt-2 bg-white text-amber-900 ring-1 ring-amber-300`}>{expiringId === alert._id ? 'Expiring…' : 'Expire alert'}</button></article>)}</div>}</div>
  </section>;
}

function AnalyticsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [byType, bySeverity, byStatus, byZone, resourceAvailability, allocationsByStatus, facilityUtilization] = await Promise.all([
        analyticsApi.incidentsByType(), analyticsApi.incidentsBySeverity(), analyticsApi.incidentsByStatus(), analyticsApi.incidentsByZone(),
        analyticsApi.resourceAvailability(), analyticsApi.allocationsByStatus(), analyticsApi.facilityUtilization(),
      ]);
      setData({ byType: records(byType), bySeverity: records(bySeverity), byStatus: records(byStatus), byZone: records(byZone), resourceAvailability: records(resourceAvailability), allocationsByStatus: records(allocationsByStatus), facilityUtilization: records(facilityUtilization) });
    } catch (cause) { setError(cause.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const totalStockAvailable = data?.resourceAvailability.reduce((sum, row) => sum + row.available_quantity, 0) ?? 0;
  const utilization = data?.facilityUtilization ?? [];
  const capacityTotal = utilization.reduce((sum, row) => sum + row.capacity_total, 0);
  const capacityUsed = utilization.reduce((sum, row) => sum + row.capacity_used, 0);
  const utilizationPercent = capacityTotal ? Math.round(capacityUsed / capacityTotal * 100) : 0;
  const distribution = (title, rows) => <div className="rounded-xl border border-slate-200 p-4"><h3 className="font-semibold">{title}</h3>{rows.length ? <ul className="mt-2 space-y-1">{rows.slice(0, 8).map((row) => <li key={row._id} className="flex justify-between gap-3 text-sm"><span className="truncate">{pretty(row._id)}</span><b>{row.count}</b></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No grouped records.</p>}</div>;
  return <section className={`${card} p-5`}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">MongoDB operational analytics</h2><p className="mt-1 text-sm text-slate-500">Live aggregation results from incidents, resources, allocations, and facilities.</p></div><button type="button" onClick={load} disabled={loading} className={`${btn} border border-slate-300`}>{loading ? 'Loading…' : 'Refresh analytics'}</button></div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Analytics could not be loaded: {error}</p>}
    {loading && !data ? <p className="mt-4 text-sm text-slate-500">Running database aggregations…</p> : data && <>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-teal-50 p-4"><p className="text-xs font-semibold uppercase text-teal-800">Available resource quantity</p><p className="mt-1 text-2xl font-bold">{totalStockAvailable}</p></div><div className="rounded-xl bg-blue-50 p-4"><p className="text-xs font-semibold uppercase text-blue-800">Facility capacity used</p><p className="mt-1 text-2xl font-bold">{capacityUsed} / {capacityTotal} ({utilizationPercent}%)</p></div><div className="rounded-xl bg-orange-50 p-4"><p className="text-xs font-semibold uppercase text-orange-800">Facilities summarized</p><p className="mt-1 text-2xl font-bold">{utilization.length}</p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{distribution('Incidents by type', data.byType)}{distribution('Incidents by severity', data.bySeverity)}{distribution('Incidents by status', data.byStatus)}{distribution('Incidents by zone', data.byZone)}{distribution('Allocations by status', data.allocationsByStatus)}</div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Facility</th><th className="p-3">Type / zone</th><th className="p-3">Capacity used</th><th className="p-3">Resource total</th><th className="p-3">Reserved</th><th className="p-3">Available</th></tr></thead><tbody className="divide-y divide-slate-100">{data.facilityUtilization.map((facility) => <tr key={facility._id}><td className="p-3 font-medium">{facility.name}</td><td className="p-3">{pretty(facility.kind)} · {facility.zone_code}</td><td className="p-3">{facility.capacity_used}/{facility.capacity_total} ({facility.capacity_utilization_percent}%)</td><td className="p-3">{facility.resource_total_quantity}</td><td className="p-3">{facility.resource_reserved_quantity}</td><td className="p-3">{facility.resource_available_quantity}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}

export default function AuthorityDashboard() {
  const auth = useAuth(); const authorized = auth.user?.role === 'AUTHORITY' || auth.user?.role === 'ADMIN';
  const [incidents, setIncidents] = useState([]); const [allocations, setAllocations] = useState([]); const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(''); const [socketStatus, setSocketStatus] = useState('connecting'); const [notice, setNotice] = useState('');
  const [reloadSignal, setReloadSignal] = useState(0); const [extraZone, setExtraZone] = useState('');

  const reloadAllocations = useCallback(async () => { const values = await fetchAllPages((params) => allocationsApi.list(params)); setAllocations(values); return values; }, []);
  const reloadIncidents = useCallback(async () => { const values = await fetchAllPages((params) => incidentsApi.list(params)); setIncidents(values); return values; }, []);
  const refreshAll = useCallback(async () => { setLoading(true); setLoadError(''); try { await Promise.all([reloadIncidents(), reloadAllocations()]); } catch (cause) { setLoadError(cause.message); } finally { setLoading(false); } }, [reloadAllocations, reloadIncidents]);

  useEffect(() => { if (authorized) refreshAll(); else setLoading(false); }, [authorized, refreshAll]);
  const activeIncidents = useMemo(() => incidents.filter(incidentIsActive).sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at)), [incidents]);
  useEffect(() => { if (selectedId && !incidents.some((item) => String(item._id) === selectedId)) setSelectedId(''); }, [incidents, selectedId]);

  const zones = useMemo(() => [...new Set([...incidents.map((item) => item.zone_code).filter(Boolean), extraZone.trim()].filter(Boolean))], [incidents, extraZone]);
  useEffect(() => {
    if (!authorized || !auth.token) { setSocketStatus('disconnected'); return undefined; }
    const socket = io(SOCKET_URL, { auth: { token: auth.token } }); let connected = false;
    socket.on('connect', () => { connected = true; setSocketStatus('live'); zones.forEach((zone) => socket.emit('zone:subscribe', zone)); });
    socket.on('connect_error', () => setSocketStatus('offline'));
    socket.on('disconnect', () => setSocketStatus('offline'));
    const updateIncident = (incident) => {
      if (!incident?._id) { reloadIncidents().catch(() => {}); return; }
      setIncidents((current) => [incident, ...current.filter((item) => String(item._id) !== String(incident._id))].sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at)));
      if (String(incident._id) === selectedId) incidentsApi.get(incident._id).then((result) => setIncidents((current) => current.map((item) => String(item._id) === String(incident._id) ? unwrap(result) : item))).catch(() => {});
    };
    const updateAllocation = (allocation) => {
      if (!allocation?._id) { reloadAllocations().catch(() => {}); return; }
      setAllocations((current) => [allocation, ...current.filter((item) => String(item._id) !== String(allocation._id))]);
      if (allocation.review_required) setNotice(`Allocation ${String(allocation._id).slice(-6)} needs road-closure review: ${allocation.review_reason || 'route affected'}.`);
    };
    const updateResponder = (event) => {
      if (event?.allocation_id) setAllocations((current) => current.map((item) => String(item._id) === String(event.allocation_id) ? { ...item, state: event.status, updated_at: event.updated_at, timeline: [...(item.timeline ?? []), { state: event.status, at: event.updated_at, by: event.responder_id }] } : item));
    };
    const handleAlert = () => setReloadSignal((value) => value + 1);
    socket.on('incident:created', updateIncident); socket.on('incident:updated', updateIncident);
    socket.on('allocation:created', updateAllocation); socket.on('allocation:updated', updateAllocation);
    socket.on('responder:status', updateResponder); socket.on('alert:created', handleAlert);
    return () => { connected = false; socket.disconnect(); if (connected) setSocketStatus('disconnected'); };
  }, [authorized, auth.token, zones, selectedId, reloadIncidents, reloadAllocations]);

  const current = incidents.find((item) => String(item._id) === selectedId);
  const activeCount = activeIncidents.length;
  const openAllocationCount = allocations.filter((item) => ACTIVE_STATES.includes(item.state)).length;
  return <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1600px]">
      <header className="flex flex-wrap items-center justify-between gap-4"><div><Link to="/" className="text-sm font-semibold text-teal-800">← ResQ home</Link><h1 className="mt-2 text-3xl font-bold tracking-tight">Authority response center</h1><p className="mt-1 text-sm text-slate-600">Incident triage, resource coordination, road status, and zone alerts.</p></div><div className="flex items-center gap-3"><span className={`rounded-full px-3 py-2 text-xs font-bold ${socketStatus === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{socketStatus === 'live' ? 'Live updates connected' : `Realtime ${socketStatus}`}</span><Link to="/analytics" className={`${btn} border border-slate-300 bg-white`}>Analytics</Link><Link to="/database" className={`${btn} border border-slate-300 bg-white`}>Database console</Link><button onClick={refreshAll} className={`${btn} border border-slate-300 bg-white`}>Refresh data</button><button onClick={auth.logout} className={`${btn} border border-slate-300 bg-white text-slate-700`}>Logout</button></div></header>
      {!authorized ? <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">This dashboard is restricted to AUTHORITY and ADMIN accounts.</p> : <>
        <section className="mt-5 grid gap-3 sm:grid-cols-3"><div className={`${card} p-4`}><p className="text-xs font-semibold uppercase text-slate-500">Active incidents</p><p className="mt-1 text-2xl font-bold">{activeCount}</p></div><div className={`${card} p-4`}><p className="text-xs font-semibold uppercase text-slate-500">Active allocations</p><p className="mt-1 text-2xl font-bold">{openAllocationCount}</p></div><div className={`${card} p-4`}><p className="text-xs font-semibold uppercase text-slate-500">Signed in as</p><p className="mt-1 text-lg font-bold">{auth.user?.name || auth.user?.role}</p><p className="text-xs text-slate-500">{auth.user?.role}</p></div></section>
        {notice && <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notification" className="font-bold">×</button></div>}
        {loadError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">Could not load dashboard data: {loadError}</p>}
        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(330px,0.75fr)_minmax(0,1.8fr)]">
          <section className={`${card} overflow-hidden`}><div className="flex items-center justify-between border-b border-slate-200 px-4 py-4"><div><h2 className="font-bold">Active incidents</h2><p className="text-xs text-slate-500">{activeCount} requiring attention</p></div><label className="sr-only" htmlFor="extra-zone">Subscribe to zone</label><input id="extra-zone" value={extraZone} onChange={(event) => setExtraZone(event.target.value)} placeholder="Add zone" className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" /></div>
            {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading incidents and allocations…</p> : !activeIncidents.length ? <p className="p-8 text-center text-sm text-slate-500">No active incidents.</p> : <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">{activeIncidents.map((incident) => {
              const linked = allocations.filter((item) => String(item.incident_id?._id ?? item.incident_id) === String(incident._id));
              return <li key={incident._id}><button onClick={() => setSelectedId(String(incident._id))} className={`w-full p-4 text-left hover:bg-teal-50 ${selectedId === String(incident._id) ? 'bg-teal-50 ring-1 ring-inset ring-teal-200' : ''}`}><div className="flex items-start justify-between gap-2"><b>{pretty(incident.type)}</b><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${incident.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-800' : 'bg-orange-100 text-orange-800'}`}>{incident.severity}</span></div><p className="mt-1 line-clamp-2 text-sm text-slate-600">{incident.description || 'No description provided.'}</p><p className="mt-2 text-xs text-slate-500">{incident.people_affected ?? 0} affected · {incident.zone_code || 'No zone'} · {incident.reported_at ? new Date(incident.reported_at).toLocaleString() : 'Time unavailable'}</p><div className="mt-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold">{pretty(incident.status)}</span><span className="text-[10px] text-slate-500">Location: {pointText(incident.location)}</span>{linked.length > 0 && <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-800">{linked.map((item) => item.state).join(', ')}</span>}</div></button></li>;
            })}</ul>}
          </section>
          <div className="space-y-5">{current ? <IncidentDetail key={current._id} incident={current} allocations={allocations} refreshKey={reloadSignal} reloadAllocations={reloadAllocations} setNotice={setNotice} /> : <section className={`${card} flex min-h-48 items-center justify-center p-6 text-center`}><div><p className="font-semibold">Select an active incident</p><p className="mt-1 text-sm text-slate-500">Incident details, reachable resources, responders, and allocations will appear here.</p></div></section>}
            <RoadsPanel reloadSignal={reloadSignal} onChanged={() => setReloadSignal((value) => value + 1)} setNotice={setNotice} />
            <AlertsPanel refreshSignal={reloadSignal} setNotice={setNotice} />
          </div>
        </div>
        <div className="mt-5"><AnalyticsPanel /></div>
      </>}
    </div>
  </main>;
}
