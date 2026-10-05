import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { analyticsApi } from '../services/api.js';

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const btn = 'rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const data = (value) => value?.data ?? value;
const pretty = (value) => (value === undefined || value === null ? '—' : String(value).replaceAll('_', ' '));
const SEVERITY_COLORS = { CRITICAL: '#be123c', HIGH: '#ea580c', MODERATE: '#d97706', LOW: '#0f766e' };
const SEVERITIES = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];

function Kpi({ label, value, tone = 'slate', hint }) {
  const tones = { slate: 'bg-white', rose: 'bg-rose-50', teal: 'bg-teal-50', amber: 'bg-amber-50', blue: 'bg-blue-50' };
  return <div className={`${card} ${tones[tone]} p-4`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold tabular-nums">{value ?? '—'}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

function PipelineTag({ children }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{children}</code>;
}

function Panel({ title, pipeline, children, action }) {
  return <section className={`${card} p-5`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{title}</h2>{pipeline && <p className="mt-1 flex flex-wrap gap-1">{pipeline.map((stage) => <PipelineTag key={stage}>{stage}</PipelineTag>)}</p>}</div>{action}</div>
    <div className="mt-4">{children}</div>
  </section>;
}

function TrendChart({ rows }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No incidents in this period.</p>;
  const max = Math.max(...rows.map((row) => row.total));
  const width = 900; const height = 220; const pad = 28;
  const barWidth = (width - pad * 2) / rows.length;
  return <div className="overflow-x-auto">
    <svg viewBox={`0 0 ${width} ${height + 30}`} className="w-full min-w-[640px]" role="img" aria-label="Daily incidents by severity">
      {[0, 0.5, 1].map((fraction) => <g key={fraction}><line x1={pad} x2={width - pad} y1={height - fraction * (height - 20)} y2={height - fraction * (height - 20)} stroke="#e2e8f0" /><text x={4} y={height - fraction * (height - 20) + 4} fontSize="10" fill="#64748b">{Math.round(max * fraction)}</text></g>)}
      {rows.map((row, index) => {
        let y = height;
        return <g key={row.day}>
          {SEVERITIES.map((severity) => {
            const value = row.by_severity?.[severity] ?? 0;
            const h = (value / max) * (height - 20);
            y -= h;
            return value ? <rect key={severity} x={pad + index * barWidth + 2} y={y} width={Math.max(2, barWidth - 4)} height={h} fill={SEVERITY_COLORS[severity]}><title>{`${row.day} ${severity}: ${value}`}</title></rect> : null;
          })}
          {(index % Math.ceil(rows.length / 10) === 0) && <text x={pad + index * barWidth + barWidth / 2} y={height + 16} fontSize="10" textAnchor="middle" fill="#64748b">{row.day.slice(5)}</text>}
        </g>;
      })}
    </svg>
    <div className="mt-2 flex flex-wrap gap-4 text-xs">{SEVERITIES.map((severity) => <span key={severity} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: SEVERITY_COLORS[severity] }} />{severity}</span>)}</div>
  </div>;
}

function Bars({ rows, label, value, color = 'bg-teal-600' }) {
  const max = Math.max(1, ...rows.map(value));
  return <ul className="space-y-2">{rows.map((row) => <li key={label(row)} className="grid grid-cols-[120px_1fr_48px] items-center gap-3 text-sm"><span className="truncate">{pretty(label(row))}</span><span className="h-3 rounded-full bg-slate-100"><span className={`block h-3 rounded-full ${color}`} style={{ width: `${(value(row) / max) * 100}%` }} /></span><b className="text-right tabular-nums">{value(row)}</b></li>)}</ul>;
}

function NearestFacilities() {
  const [form, setForm] = useState({ latitude: '13.02', longitude: '80.24', kind: '' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  async function run(event) {
    event?.preventDefault(); setError('');
    try { setRows(data(await analyticsApi.nearestFacilities({ latitude: form.latitude, longitude: form.longitude, kind: form.kind, limit: 5 }))); }
    catch (cause) { setError(cause.message); }
  }
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return <Panel title="Nearest facilities to a location" pipeline={['$geoNear', '$limit', '$lookup resources', '$project']}>
    <form onSubmit={run} className="grid gap-3 sm:grid-cols-4">
      <label className="text-xs font-semibold">Latitude<input value={form.latitude} onChange={set('latitude')} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <label className="text-xs font-semibold">Longitude<input value={form.longitude} onChange={set('longitude')} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm" /></label>
      <label className="text-xs font-semibold">Kind<select value={form.kind} onChange={set('kind')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="">Any</option>{['SHELTER', 'HOSPITAL', 'RELIEF_CENTRE', 'DEPOT'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
      <div className="flex items-end"><button className={`${btn} w-full bg-teal-700 text-white`}>Find nearest</button></div>
    </form>
    {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {rows && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2">Facility</th><th className="p-2">Kind · zone</th><th className="p-2">Distance</th><th className="p-2">Free beds</th><th className="p-2">Stock available</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row._id}><td className="p-2 font-medium">{row.name}</td><td className="p-2">{pretty(row.kind)} · {row.zone_code}</td><td className="p-2 tabular-nums">{row.distance_km} km</td><td className="p-2 tabular-nums">{row.capacity_free}/{row.capacity_total}</td><td className="p-2 text-xs">{row.stock.map((item) => `${pretty(item.category)} ${item.available}`).join(' · ') || '—'}</td></tr>)}</tbody></table></div>}
  </Panel>;
}

export default function AnalyticsPage() {
  const [state, setState] = useState({ loading: true, error: '', values: null });
  const [days, setDays] = useState(30);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const [dashboard, trend, hotspots, buckets, skills, responseTimes, lowStock] = await Promise.all([
        analyticsApi.dashboard(), analyticsApi.trend(days), analyticsApi.hotspots(), analyticsApi.sizeBuckets(),
        analyticsApi.skills(), analyticsApi.responseTimes(), analyticsApi.lowStock(60),
      ]);
      setState({ loading: false, error: '', values: { dashboard: data(dashboard), trend: data(trend), hotspots: data(hotspots), buckets: data(buckets), skills: data(skills), responseTimes: data(responseTimes)?.[0] ?? {}, lowStock: data(lowStock) } });
    } catch (cause) { setState({ loading: false, error: cause.message, values: null }); }
  }, [days]);
  useEffect(() => { load(); }, [load]);
  const v = state.values;
  const totals = v?.dashboard?.totals ?? {};

  return <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1400px]">
      <header className="flex flex-wrap items-center justify-between gap-4"><div><Link to="/authority" className="text-sm font-semibold text-teal-800">← Authority dashboard</Link><h1 className="mt-2 text-3xl font-bold tracking-tight">Operational analytics</h1><p className="mt-1 text-sm text-slate-600">Every figure on this page is computed live by a MongoDB aggregation pipeline.</p></div>
        <div className="flex items-center gap-2"><Link to="/database" className={`${btn} border border-slate-300 bg-white`}>Database console</Link><button onClick={load} disabled={state.loading} className={`${btn} bg-teal-800 text-white`}>{state.loading ? 'Running…' : 'Re-run pipelines'}</button></div></header>
      {state.error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{state.error}</p>}
      {v && <>
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Total incidents" value={totals.total_incidents} />
          <Kpi label="Open incidents" value={totals.open_incidents} tone="amber" />
          <Kpi label="Critical & open" value={totals.critical_open} tone="rose" />
          <Kpi label="People affected" value={totals.people_affected?.toLocaleString()} tone="blue" />
          <Kpi label="Avg minutes to scene" value={v.responseTimes.avg_minutes_to_scene ?? '—'} tone="teal" hint={`${v.responseTimes.allocations_measured ?? 0} allocations · $filter on timeline`} />
        </section>
        <div className="mt-5"><Panel title="Daily incidents by severity" pipeline={['$match reported_at', '$group day+severity', '$group day', '$arrayToObject', '$sort']} action={<select value={days} onChange={(event) => setDays(Number(event.target.value))} className="rounded-lg border border-slate-300 bg-white p-2 text-sm">{[7, 14, 30, 60].map((value) => <option key={value} value={value}>Last {value} days</option>)}</select>}><TrendChart rows={v.trend} /></Panel></div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel title="Zone hotspots (open incidents vs free capacity)" pipeline={['$match open', '$group zone', '$lookup facilities', '$project pressure_score', '$sort']}>
            <div className="max-h-96 overflow-y-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2">Zone</th><th className="p-2">Open</th><th className="p-2">Critical</th><th className="p-2">People</th><th className="p-2">Free beds</th><th className="p-2">Score</th></tr></thead><tbody className="divide-y divide-slate-100">{v.hotspots.map((row) => <tr key={row.zone_code}><td className="p-2 font-semibold">{row.zone_code}</td><td className="p-2 tabular-nums">{row.open_incidents}</td><td className="p-2 tabular-nums text-rose-700">{row.critical}</td><td className="p-2 tabular-nums">{row.people_affected}</td><td className="p-2 tabular-nums">{row.capacity_free}</td><td className="p-2"><span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">{row.pressure_score}</span></td></tr>)}</tbody></table></div>
          </Panel>
          <div className="space-y-5">
            <Panel title="Incident size distribution" pipeline={['$bucket people_affected', '$project $switch']}><Bars rows={v.buckets} label={(row) => `${row.range} people`} value={(row) => row.incidents} color="bg-orange-500" /></Panel>
            <Panel title="Responder skill coverage" pipeline={['$match role', '$unwind skills', '$group skill']}><Bars rows={v.skills} label={(row) => row.skill} value={(row) => row.responders} /><p className="mt-2 text-xs text-slate-500">Available now: {v.skills.map((row) => `${pretty(row.skill)} ${row.available}`).join(' · ')}</p></Panel>
          </div>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <NearestFacilities />
          <Panel title="Low-stock lines (available < 60)" pipeline={['$project available', '$match', '$lookup facilities', '$sort']}>
            {!v.lowStock.length ? <p className="text-sm text-slate-500">No stock lines below the threshold.</p> : <div className="max-h-80 overflow-y-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2">Item</th><th className="p-2">Facility</th><th className="p-2">Available</th></tr></thead><tbody className="divide-y divide-slate-100">{v.lowStock.map((row) => <tr key={row._id}><td className="p-2">{pretty(row.item)} <span className="text-xs text-slate-500">({pretty(row.category)})</span></td><td className="p-2">{row.facility} · {row.zone_code}</td><td className="p-2 font-semibold tabular-nums text-rose-700">{row.available} {row.unit}</td></tr>)}</tbody></table></div>}
          </Panel>
        </div>
      </>}
    </div>
  </main>;
}
