import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { incidentsApi } from '../services/api.js';

const INCIDENT_TYPES = ['FLOOD', 'EARTHQUAKE', 'CYCLONE', 'LANDSLIDE', 'FIRE', 'MEDICAL', 'STRUCTURAL', 'OTHER'];

function getLocationError(error) {
  if (error.code === 1) return 'Location permission was denied. Allow location access in your browser settings, then try again.';
  if (error.code === 2) return 'Your current location could not be determined. Check your device location settings and try again.';
  if (error.code === 3) return 'Location lookup timed out. Please try again.';
  return 'Could not get your current location. Please try again.';
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'just now' : date.toLocaleString();
}

export default function ReportIncident() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ type: '', description: '', people_affected: '0', zone_code: '', needs: '', media: '' });
  const [location, setLocation] = useState(null);
  const [locationState, setLocationState] = useState('idle');
  const [locationMessage, setLocationMessage] = useState('');
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdIncident, setCreatedIncident] = useState(null);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setValidationError('');
  }

  function requestLocation() {
    setError('');
    setLocationMessage('');
    if (!navigator.geolocation) {
      setLocationState('error');
      setLocationMessage('This browser does not support location access. ResQ needs your current location to submit a report.');
      return;
    }
    setLocation(null);
    setLocationState('loading');
    navigator.geolocation.getCurrentPosition((position) => {
      setLocation({ longitude: position.coords.longitude, latitude: position.coords.latitude });
      setLocationState('ready');
      setLocationMessage('Current location captured.');
    }, (cause) => {
      setLocationState(cause.code === 1 ? 'denied' : 'error');
      setLocationMessage(getLocationError(cause));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setValidationError('');
    if (!location) {
      setValidationError('Get your current location before submitting. ResQ does not estimate or fill in coordinates.');
      return;
    }
    const peopleAffected = Number(form.people_affected);
    if (!Number.isInteger(peopleAffected) || peopleAffected < 0 || peopleAffected > 10000) {
      setValidationError('People affected must be a whole number from 0 to 10,000.');
      return;
    }
    const body = {
      type: form.type,
      description: form.description.trim(),
      people_affected: peopleAffected,
      location: { type: 'Point', coordinates: [location.longitude, location.latitude] },
      needs: form.needs.split(',').map((value) => value.trim()).filter(Boolean),
      media: form.media.split('\n').map((value) => value.trim()).filter(Boolean),
    };
    const zoneCode = form.zone_code.trim();
    if (zoneCode) body.zone_code = zoneCode;

    setLoading(true);
    try {
      const result = await incidentsApi.create(body);
      setCreatedIncident(result.data);
    } catch (cause) {
      setError(cause.message || 'Your report could not be submitted. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (createdIncident) {
    return <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-8"><section className="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-white p-7 shadow-sm sm:p-9">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl font-bold text-emerald-800" aria-hidden="true">✓</div>
      <p className="mt-5 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-800">Report received</p>
      <h1 className="mt-2 text-3xl font-bold">Your emergency report was submitted.</h1>
      <p className="mt-3 text-slate-600">ResQ recorded your report at {formatTime(createdIncident.reported_at)}.</p>
      <dl className="mt-7 grid gap-4 rounded-xl bg-slate-50 p-5 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Incident</dt><dd className="mt-1 font-semibold">{createdIncident.type} · {createdIncident.severity}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Status</dt><dd className="mt-1 font-semibold">{createdIncident.status}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">People affected</dt><dd className="mt-1 font-semibold">{createdIncident.people_affected}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-slate-500">Zone</dt><dd className="mt-1 font-semibold">{createdIncident.zone_code || 'Unassigned'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-slate-500">Description</dt><dd className="mt-1 whitespace-pre-wrap">{createdIncident.description || 'No description provided.'}</dd></div>
      </dl>
      <button onClick={() => navigate('/citizen', { replace: true })} className="mt-7 rounded-lg bg-teal-800 px-5 py-3 font-semibold text-white hover:bg-teal-900">Return to Citizen Dashboard</button>
    </section></main>;
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8"><div className="mx-auto max-w-3xl">
    <Link to="/citizen" className="text-sm font-semibold text-teal-800">← Citizen dashboard</Link>
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-700">Emergency report</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Tell us what is happening</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Share the details responders need. Your current location is required and will only be added after you allow your browser to retrieve it.</p>

      <form onSubmit={submit} className="mt-7 space-y-6">
        <label className="block text-sm font-semibold text-slate-700">Incident type <span className="text-rose-600">*</span>
          <select name="type" required value={form.type} onChange={update} className={inputClass}><option value="" disabled>Select an incident type</option>{INCIDENT_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select>
        </label>

        <label className="block text-sm font-semibold text-slate-700">Description
          <textarea name="description" value={form.description} onChange={update} maxLength={1000} rows={4} className={inputClass} placeholder="Describe what happened and any urgent details." />
          <span className="mt-1 block text-right text-xs font-normal text-slate-500">{form.description.length}/1000</span>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">People affected
            <input name="people_affected" type="number" min="0" max="10000" step="1" value={form.people_affected} onChange={update} className={inputClass} />
            <span className="mt-1 block text-xs font-normal text-slate-500">Enter a whole number.</span>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Zone code <span className="font-normal text-slate-500">(optional)</span>
            <input name="zone_code" value={form.zone_code} onChange={update} maxLength={80} className={inputClass} placeholder="For example, Z-01" />
          </label>
        </div>

        <section aria-labelledby="location-heading" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 id="location-heading" className="text-sm font-semibold text-slate-800">Current location <span className="text-rose-600">*</span></h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">The report requires a real location from your device. ResQ will not guess or substitute coordinates.</p>
          {location && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-700">Latitude {location.latitude.toFixed(6)}, longitude {location.longitude.toFixed(6)}</p>}
          {locationMessage && <p role={locationState === 'denied' || locationState === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${locationState === 'denied' || locationState === 'error' ? 'text-rose-800' : 'text-emerald-800'}`}>{locationMessage}</p>}
          <button type="button" onClick={requestLocation} disabled={locationState === 'loading'} className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-teal-700 disabled:cursor-wait disabled:opacity-60">{locationState === 'loading' ? 'Getting location…' : location ? 'Refresh current location' : 'Use my current location'}</button>
        </section>

        <label className="block text-sm font-semibold text-slate-700">Needs <span className="font-normal text-slate-500">(optional, comma separated)</span>
          <input name="needs" value={form.needs} onChange={update} className={inputClass} placeholder="Water, medical support, evacuation" />
        </label>

        <label className="block text-sm font-semibold text-slate-700">Media references <span className="font-normal text-slate-500">(optional, one URL or reference per line)</span>
          <textarea name="media" value={form.media} onChange={update} rows={2} className={inputClass} placeholder="https://…" />
          <span className="mt-1 block text-xs font-normal text-slate-500">The existing API accepts media references as strings; file upload is not available.</span>
        </label>

        {validationError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{validationError}</p>}
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-teal-800 px-5 py-3 font-semibold text-white shadow-sm hover:bg-teal-900 disabled:cursor-wait disabled:opacity-60">{loading ? 'Submitting report…' : 'Submit Emergency Report'}</button>
      </form>
    </section>
  </div></main>;
}

const inputClass = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100';
