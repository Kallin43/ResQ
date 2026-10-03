import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { facilitiesApi, resourcesApi } from '../services/api.js';

const FACILITY_KINDS = [
  { value: 'SHELTER', label: 'Shelter' },
  { value: 'HOSPITAL', label: 'Hospital' },
  { value: 'RELIEF_CENTRE', label: 'Relief centre' },
  { value: 'DEPOT', label: 'Depot' },
];
const PAGE_SIZE = 12;

function validPoint(location) {
  const values = location?.type === 'Point' ? location.coordinates : null;
  return Array.isArray(values) && values.length === 2 && values.every(Number.isFinite)
    && values[0] >= -180 && values[0] <= 180 && values[1] >= -90 && values[1] <= 90;
}

function distanceMeters(first, second) {
  if (!validPoint(first) || !validPoint(second)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const [lon1, lat1] = first.coordinates;
  const [lon2, lat2] = second.coordinates;
  const latitudeDelta = radians(lat2 - lat1);
  const longitudeDelta = radians(lon2 - lon1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distance) {
  if (distance === null) return 'Distance unavailable';
  return distance < 1000 ? `${Math.round(distance)} m away` : `${(distance / 1000).toFixed(1)} km away`;
}

function facilityAddress(facility) {
  const values = [facility.address?.line1, facility.address?.ward && `Ward ${facility.address.ward}`, facility.address?.district, facility.zone_code].filter(Boolean);
  return values.length ? values.join(' · ') : 'Address not provided';
}

function locationPermissionMessage(error) {
  if (error.code === 1) return 'Location permission was denied. Allow location access for this site in your browser settings, then try again.';
  if (error.code === 2) return 'Your current location could not be determined. Check your device location settings and try again.';
  if (error.code === 3) return 'Location lookup timed out. Please try again.';
  return 'Could not get your current location. Please try again.';
}

export default function FacilitiesPage() {
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [facilities, setFacilities] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');
  const [locationMessage, setLocationMessage] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [facilityDetails, setFacilityDetails] = useState(null);
  const [resources, setResources] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [resourceError, setResourceError] = useState('');

  const loadFacilities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await facilitiesApi.list({ operational: true, page, limit: PAGE_SIZE, kind: kind || undefined });
      setFacilities(result.data ?? []);
      setPagination(result.pagination ?? { page, limit: PAGE_SIZE, total: (result.data ?? []).length, pages: 1 });
    } catch (cause) {
      setError(cause.message || 'Could not load facilities.');
    } finally {
      setLoading(false);
    }
  }, [page, kind]);

  useEffect(() => { loadFacilities(); }, [loadFacilities]);

  const sortedFacilities = useMemo(() => {
    if (!location) return facilities;
    return [...facilities].sort((a, b) => {
      const left = distanceMeters(location, a.location);
      const right = distanceMeters(location, b.location);
      if (left === null && right === null) return a.name.localeCompare(b.name);
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    });
  }, [facilities, location]);

  function useCurrentLocation() {
    setLocationMessage('');
    if (!navigator.geolocation) {
      setLocationStatus('error');
      setLocationMessage('This browser does not support location access. Distances cannot be calculated.');
      return;
    }
    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition((position) => {
      setLocation({ type: 'Point', coordinates: [position.coords.longitude, position.coords.latitude] });
      setLocationStatus('ready');
      setLocationMessage('Distances are calculated from your current location.');
    }, (cause) => {
      setLocation(null);
      setLocationStatus(cause.code === 1 ? 'denied' : 'error');
      setLocationMessage(locationPermissionMessage(cause));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async function toggleDetails(facilityId) {
    if (expandedId === facilityId) {
      setExpandedId('');
      setFacilityDetails(null);
      setResources([]);
      return;
    }
    setExpandedId(facilityId);
    setFacilityDetails(null);
    setResources([]);
    setDetailError('');
    setResourceError('');
    setDetailLoading(true);
    const [facilityResult, resourceResult] = await Promise.allSettled([
      facilitiesApi.get(facilityId),
      resourcesApi.list({ facility_id: facilityId, page: 1, limit: 100 }),
    ]);
    if (facilityResult.status === 'fulfilled') setFacilityDetails(facilityResult.value.data);
    else setDetailError(facilityResult.reason?.message || 'Could not load facility details.');
    if (resourceResult.status === 'fulfilled') setResources(resourceResult.value.data ?? []);
    else setResourceError(resourceResult.reason?.message || 'Could not load resource stock.');
    setDetailLoading(false);
  }

  function changeKind(event) {
    setKind(event.target.value);
    setPage(1);
    setExpandedId('');
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8"><div className="mx-auto max-w-6xl">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><Link to="/citizen" className="text-sm font-semibold text-teal-800">← Citizen dashboard</Link><p className="mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-teal-700">ResQ facilities</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Nearby facilities</h1><p className="mt-2 text-slate-600">Find operational shelters, hospitals, relief centres, and depots.</p></div>
      <button type="button" onClick={useCurrentLocation} disabled={locationStatus === 'loading'} className="rounded-lg bg-teal-800 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-900 disabled:cursor-wait disabled:opacity-60">{locationStatus === 'loading' ? 'Getting location…' : location ? 'Refresh current location' : 'Use my current location'}</button>
    </header>

    <section className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <label className="block min-w-56 text-sm font-semibold text-slate-700">Facility type
        <select value={kind} onChange={changeKind} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-900 focus:border-teal-700 focus:outline-none"><option value="">All kinds</option>{FACILITY_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      </label>
      <div className="text-sm text-slate-500">{location ? 'Sorted by distance within this page.' : 'Distance is unavailable until you share your current location.'}</div>
      {locationMessage && <p role={locationStatus === 'denied' || locationStatus === 'error' ? 'alert' : 'status'} className={`basis-full text-sm ${locationStatus === 'denied' || locationStatus === 'error' ? 'text-rose-800' : 'text-emerald-800'}`}>{locationMessage}</p>}
    </section>

    {loading && <p role="status" className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading facilities…</p>}
    {!loading && error && <div role="alert" className="mt-6 rounded-xl bg-rose-50 p-5 text-sm text-rose-800"><p>{error}</p><button onClick={loadFacilities} className="mt-3 font-semibold underline">Try again</button></div>}
    {!loading && !error && sortedFacilities.length === 0 && <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center"><h2 className="font-semibold">No operational facilities found</h2><p className="mt-2 text-sm text-slate-600">Try another facility type or check back later.</p></div>}

    {!loading && !error && sortedFacilities.length > 0 && <>
      <p className="mt-5 text-sm text-slate-500">Showing {sortedFacilities.length} of {pagination.total} operational facilities · page {pagination.page} of {Math.max(pagination.pages, 1)}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {sortedFacilities.map((facility) => {
          const distance = location ? distanceMeters(location, facility.location) : null;
          const detail = expandedId === facility._id ? facilityDetails : null;
          return <article key={facility._id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-5">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{facility.name}</h2><p className="mt-1 text-sm text-slate-500">{facility.kind.replaceAll('_', ' ')}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${facility.operational ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{facility.operational ? 'Operational' : 'Not operational'}</span></div>
              <p className="mt-4 text-sm text-slate-600">{facilityAddress(facility)}</p>
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2"><p><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Available capacity</span><span className="mt-1 block font-semibold">{facility.capacity_free ?? '—'} / {facility.capacity_total ?? '—'}</span></p><p><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Distance</span><span className="mt-1 block font-semibold">{location ? formatDistance(distance) : 'Use current location to calculate'}</span></p></div>
              <button type="button" onClick={() => toggleDetails(facility._id)} aria-expanded={expandedId === facility._id} className="mt-4 text-sm font-semibold text-teal-800 hover:underline">{expandedId === facility._id ? 'Hide details' : 'View facility details'}</button>
            </div>
            {expandedId === facility._id && <div className="border-t border-slate-200 bg-slate-50 p-5">
              {detailLoading && <p role="status" className="text-sm text-slate-600">Loading facility details…</p>}
              {detailError && <p role="alert" className="text-sm text-rose-800">{detailError}</p>}
              {detail && <>
                <div className="grid gap-3 text-sm sm:grid-cols-2"><p><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Address</span><span className="mt-1 block">{facilityAddress(detail)}</span></p><p><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Services</span><span className="mt-1 block">{detail.services?.length ? detail.services.join(', ') : 'Not listed'}</span></p>{validPoint(detail.location) && <p className="sm:col-span-2"><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Facility coordinates</span><span className="mt-1 block">{detail.location.coordinates[1].toFixed(5)}, {detail.location.coordinates[0].toFixed(5)}</span></p>}</div>
                <div className="mt-5"><h3 className="text-sm font-semibold">Available resources / stock</h3>{resourceError && <p role="status" className="mt-2 text-sm text-amber-900">{resourceError}</p>}{!resourceError && resources.length === 0 && <p className="mt-2 text-sm text-slate-600">No resource stock is listed for this facility.</p>}{resources.length > 0 && <ul className="mt-2 divide-y divide-slate-200">{resources.map((resource) => <li key={resource._id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{resource.item} <span className="text-slate-500">· {resource.category}</span></span><span className="font-semibold">{Math.max(0, resource.quantity - resource.reserved)} {resource.unit} available</span></li>)}</ul>}</div>
              </>}
            </div>}
          </article>;
        })}
      </div>
      <nav aria-label="Facility pages" className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button><span className="text-sm text-slate-600">Page {pagination.page} of {Math.max(pagination.pages, 1)}</span><button type="button" disabled={page >= pagination.pages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button></nav>
    </>}
  </div></main>;
}
