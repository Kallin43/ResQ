import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { analyticsApi, facilitiesApi, incidentsApi, resourcesApi } from '../services/api.js';

const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm';
const btn = 'rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const input = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm';
const data = (value) => value?.data ?? value;
const pretty = (value) => (value === undefined || value === null ? '—' : String(value).replaceAll('_', ' '));
const TABS = [
  ['resources', 'Resources CRUD'],
  ['incidents', 'Incidents CRUD'],
  ['indexes', 'Indexes'],
  ['explain', 'Query plans'],
  ['redis', 'Redis state'],
];

function Message({ message }) {
  if (!message) return null;
  return <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${message.error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{message.text}</p>;
}

function ResourcesCrud() {
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityId] = useState('');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ category: 'WATER', item: '', quantity: 100, unit: 'litres' });
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    facilitiesApi.listAll({ limit: 100 }).then((result) => {
      const list = data(result); setFacilities(list); if (list[0]) setFacilityId(list[0]._id);
    }).catch((cause) => setMessage({ error: true, text: cause.message }));
  }, []);
  const load = useCallback(async () => {
    if (!facilityId) return;
    setRows(data(await resourcesApi.list({ facility_id: facilityId, limit: 100 })));
  }, [facilityId]);
  useEffect(() => { load().catch((cause) => setMessage({ error: true, text: cause.message })); }, [load]);

  const act = async (label, fn) => {
    setMessage(null);
    try { await fn(); await load(); setMessage({ text: label }); } catch (cause) { setMessage({ error: true, text: cause.message }); }
  };
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const facility = facilities.find((item) => item._id === facilityId);

  return <div>
    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
      <label className="text-xs font-semibold">Facility (READ: find by facility_id, uses facility_id_1_category_1)<select value={facilityId} onChange={(event) => setFacilityId(event.target.value)} className={input}>{facilities.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.zone_code}</option>)}</select></label>
      {facility && <div className="rounded-xl bg-slate-50 p-3 text-xs"><b>{pretty(facility.kind)}</b> · capacity {facility.capacity_free}/{facility.capacity_total}<br />services: {facility.services?.join(', ') || '—'}</div>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); act(`Created ${form.item}.`, () => resourcesApi.create({ facility_id: facilityId, category: form.category, item: form.item, quantity: Number(form.quantity), unit: form.unit })); }} className="mt-4 grid gap-3 rounded-xl border border-dashed border-teal-300 bg-teal-50/40 p-3 sm:grid-cols-5">
      <label className="text-xs font-semibold">Category<select value={form.category} onChange={set('category')} className={input}>{['FOOD', 'WATER', 'MEDICINE', 'BEDDING', 'RESCUE_EQUIPMENT', 'HYGIENE'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-semibold">Item<input required value={form.item} onChange={set('item')} placeholder="e.g. water_cans" className={input} /></label>
      <label className="text-xs font-semibold">Quantity<input type="number" min="0" value={form.quantity} onChange={set('quantity')} className={input} /></label>
      <label className="text-xs font-semibold">Unit<input required value={form.unit} onChange={set('unit')} className={input} /></label>
      <div className="flex items-end"><button className={`${btn} w-full bg-teal-700 text-white`}>CREATE (POST)</button></div>
    </form>
    <Message message={message} />
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2">Category</th><th className="p-2">Item</th><th className="p-2">Quantity</th><th className="p-2">Reserved</th><th className="p-2">Unit</th><th className="p-2 text-right">Actions</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map((row) => editing?._id === row._id
        ? <tr key={row._id} className="bg-amber-50"><td className="p-2">{pretty(row.category)}</td><td className="p-2"><input value={editing.item} onChange={(event) => setEditing({ ...editing, item: event.target.value })} className="w-full rounded border p-1" /></td><td className="p-2"><input type="number" value={editing.quantity} onChange={(event) => setEditing({ ...editing, quantity: event.target.value })} className="w-24 rounded border p-1" /></td><td className="p-2"><input type="number" value={editing.reserved} onChange={(event) => setEditing({ ...editing, reserved: event.target.value })} className="w-20 rounded border p-1" /></td><td className="p-2">{row.unit}</td><td className="p-2 text-right"><button onClick={() => act('Updated.', async () => { await resourcesApi.update(row._id, { item: editing.item, quantity: Number(editing.quantity), reserved: Number(editing.reserved) }); setEditing(null); })} className={`${btn} bg-amber-600 text-white`}>Save (PATCH)</button> <button onClick={() => setEditing(null)} className={`${btn} border`}>Cancel</button></td></tr>
        : <tr key={row._id}><td className="p-2">{pretty(row.category)}</td><td className="p-2 font-medium">{row.item}</td><td className="p-2 tabular-nums">{row.quantity}</td><td className="p-2 tabular-nums">{row.reserved}</td><td className="p-2">{row.unit}</td><td className="p-2 text-right"><button onClick={() => setEditing({ ...row })} className={`${btn} border border-slate-300`}>Edit</button> <button onClick={() => act(`Deleted ${row.item}.`, () => resourcesApi.remove(row._id))} className={`${btn} border border-rose-300 text-rose-700`}>Delete</button></td></tr>)}</tbody></table></div>
  </div>;
}

function IncidentsCrud() {
  const [q, setQ] = useState('water rescue');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState(null);
  const search = useCallback(async () => {
    setMessage(null);
    try { setRows(data(await incidentsApi.search(q))); } catch (cause) { setMessage({ error: true, text: cause.message }); }
  }, [q]);
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (label, fn) => {
    try { await fn(); await search(); setMessage({ text: label }); } catch (cause) { setMessage({ error: true, text: cause.message }); }
  };
  return <div>
    <form onSubmit={(event) => { event.preventDefault(); search(); }} className="flex flex-wrap gap-2"><input value={q} onChange={(event) => setQ(event.target.value)} className="min-w-64 flex-1 rounded-lg border border-slate-300 p-2 text-sm" placeholder="Search descriptions and needs" /><button className={`${btn} bg-teal-700 text-white`}>$text search</button></form>
    <p className="mt-2 text-xs text-slate-500">Uses the <code>incident_text_search</code> text index (description weight 5, needs weight 2); results sorted by <code>textScore</code>.</p>
    <Message message={message} />
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2">Score</th><th className="p-2">Description</th><th className="p-2">Type · severity</th><th className="p-2">Status</th><th className="p-2 text-right">Actions</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.slice(0, 15).map((row) => <tr key={row._id}><td className="p-2 tabular-nums text-xs">{row.score?.toFixed(2)}</td><td className="p-2">{row.description}<div className="text-xs text-slate-500">{row.zone_code} · {row.people_affected} people · {new Date(row.reported_at).toLocaleDateString()}</div></td><td className="p-2 text-xs">{pretty(row.type)} · <b>{row.severity}</b></td><td className="p-2"><select value={row.status} onChange={(event) => act(`Status set to ${event.target.value}.`, () => incidentsApi.updateStatus(row._id, event.target.value))} className="rounded border p-1 text-xs">{['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'DUPLICATE', 'UNREACHABLE'].map((status) => <option key={status}>{status}</option>)}</select></td><td className="p-2 text-right"><button onClick={() => act('Incident deleted.', () => incidentsApi.remove(row._id))} className={`${btn} border border-rose-300 text-rose-700`}>Delete</button></td></tr>)}</tbody></table></div>
  </div>;
}

function Indexes() {
  const [rows, setRows] = useState(null);
  useEffect(() => { analyticsApi.indexes().then((result) => setRows(data(result))); }, []);
  if (!rows) return <p className="text-sm text-slate-500">Reading index catalogue…</p>;
  const total = rows.reduce((sum, row) => sum + row.indexes.length, 0);
  return <div><p className="text-sm text-slate-600">{total} indexes across {rows.length} collections (<code>db.collection.getIndexes()</code>).</p>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">{rows.map((collection) => <div key={collection.collection} className="rounded-xl border border-slate-200 p-4"><div className="flex justify-between"><h3 className="font-bold">{collection.collection}</h3><span className="text-xs text-slate-500">{collection.documents.toLocaleString()} documents</span></div>
      <ul className="mt-2 space-y-1.5">{collection.indexes.map((index) => <li key={index.name} className="text-xs"><code className="font-semibold text-slate-800">{index.name}</code> <span className="text-slate-500">{JSON.stringify(index.key)}</span> {index.unique && <span className="rounded bg-blue-100 px-1.5 text-blue-800">unique</span>} {index.partial && <span className="rounded bg-violet-100 px-1.5 text-violet-800">partial</span>} {index.text && <span className="rounded bg-amber-100 px-1.5 text-amber-800">text</span>} {index.geo && <span className="rounded bg-emerald-100 px-1.5 text-emerald-800">2dsphere</span>}</li>)}</ul></div>)}</div></div>;
}

function Explain() {
  const [queries, setQueries] = useState([]);
  const [results, setResults] = useState({});
  useEffect(() => { analyticsApi.explainQueries().then((result) => setQueries(data(result))); }, []);
  const runAll = async () => {
    for (const query of queries) {
      const result = data(await analyticsApi.explain(query.name));
      setResults((current) => ({ ...current, [query.name]: result }));
    }
  };
  useEffect(() => { if (queries.length) runAll(); }, [queries]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div><div className="flex items-center justify-between"><p className="text-sm text-slate-600">Each application query is run with <code>.explain('executionStats')</code>; the winning plan shows whether an index was used.</p><button onClick={runAll} className={`${btn} border border-slate-300`}>Re-run explain</button></div>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2">Query</th><th className="p-2">Expected index</th><th className="p-2">Winning stage</th><th className="p-2">Index used</th><th className="p-2">Keys / docs examined</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{queries.map((query) => { const summary = results[query.name]?.summary; return <tr key={query.name}><td className="p-2">{query.description}</td><td className="p-2 text-xs"><code>{query.expected_index}</code></td><td className="p-2">{summary ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${summary.collection_scan ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>{summary.winning_stage}</span> : '…'}</td><td className="p-2 text-xs"><code>{summary?.index_used ?? '—'}</code></td><td className="p-2 text-xs tabular-nums">{summary ? `${summary.keys_examined ?? 'n/a'} / ${summary.docs_examined ?? 'n/a'}` : ''}</td></tr>; })}</tbody></table></div></div>;
}

function RedisState() {
  const [state, setState] = useState(null);
  const load = useCallback(() => analyticsApi.redis().then((result) => setState(data(result))), []);
  useEffect(() => { load(); }, [load]);
  if (!state) return <p className="text-sm text-slate-500">Reading Redis…</p>;
  if (!state.connected) return <p className="text-sm text-amber-800">Redis is not connected.</p>;
  return <div>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-rose-50 p-4"><p className="text-xs font-semibold uppercase text-rose-800">incident:live (sorted set)</p><p className="text-2xl font-bold">{state.live_incident_queue}</p></div><div className="rounded-xl bg-amber-50 p-4"><p className="text-xs font-semibold uppercase text-amber-800">alerts:active (sorted set)</p><p className="text-2xl font-bold">{state.active_alerts}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-600">Total keys (DBSIZE)</p><p className="text-2xl font-bold">{state.db_size}</p></div></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div><h3 className="font-semibold">Latest live incidents <span className="text-xs font-normal text-slate-500">ZRANGE incident:live 0 9 REV + GET incident:&lt;id&gt;:summary</span></h3><ul className="mt-2 divide-y divide-slate-100 text-sm">{state.latest_live.map((row) => <li key={row._id} className="flex justify-between py-1.5"><span>{pretty(row.type)} · {row.zone_code} · <b>{row.severity}</b></span><span className="text-xs text-slate-500">TTL {row.ttl_seconds}s</span></li>)}</ul></div>
      <div><h3 className="font-semibold">Capacity / stock counters <span className="text-xs font-normal text-slate-500">SCAN facility:*</span></h3><ul className="mt-2 divide-y divide-slate-100 font-mono text-xs">{state.counters.map((row) => <li key={row.key} className="flex justify-between py-1.5"><span className="truncate">{row.key}</span><b>{row.value}</b></li>)}</ul></div>
    </div>
    <button onClick={load} className={`${btn} mt-4 border border-slate-300`}>Refresh</button>
  </div>;
}

export default function DatabasePage() {
  const [tab, setTab] = useState('resources');
  return <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1400px]">
      <header className="flex flex-wrap items-center justify-between gap-4"><div><Link to="/authority" className="text-sm font-semibold text-teal-800">← Authority dashboard</Link><h1 className="mt-2 text-3xl font-bold tracking-tight">Database console</h1><p className="mt-1 text-sm text-slate-600">CRUD operations, index catalogue, query plans and Redis operational state.</p></div><Link to="/analytics" className={`${btn} border border-slate-300 bg-white`}>Analytics</Link></header>
      <nav className="mt-5 flex flex-wrap gap-2">{TABS.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`${btn} ${tab === key ? 'bg-teal-800 text-white' : 'border border-slate-300 bg-white'}`}>{label}</button>)}</nav>
      <section className={`${card} mt-4 p-5`}>
        {tab === 'resources' && <ResourcesCrud />}
        {tab === 'incidents' && <IncidentsCrud />}
        {tab === 'indexes' && <Indexes />}
        {tab === 'explain' && <Explain />}
        {tab === 'redis' && <RedisState />}
      </section>
    </div>
  </main>;
}
