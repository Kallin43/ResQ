import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { authApi } from '../services/api.js';

export default function Register() {
  const [form, setForm] = useState({ name: '', phone: '', password: '', role: 'CITIZEN', skills: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.isAuthenticated) return <Navigate to="/" replace />;
  function update(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }

  async function submit(event) {
    event.preventDefault(); setError(''); setLoading(true);
    const body = { name: form.name.trim(), phone: form.phone.trim(), password: form.password, role: form.role };
    if (form.role === 'VOLUNTEER' && form.skills.trim()) body.skills = form.skills.split(',').map((skill) => skill.trim()).filter(Boolean);
    try { await authApi.register(body); navigate('/login', { replace: true, state: { registered: true } }); }
    catch (cause) { setError(cause.message); }
    finally { setLoading(false); }
  }

  return <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900"><div className="mx-auto max-w-md"><Link to="/" className="text-2xl font-bold text-teal-800">ResQ<span className="text-orange-500">.</span></Link><section className="mt-8 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><h1 className="text-2xl font-bold">Create your account</h1><p className="mt-2 mb-6 text-slate-600">Join ResQ to support your community.</p><form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-semibold text-slate-700">Full name<input name="name" autoComplete="name" required maxLength={120} value={form.name} onChange={update} className={inputClass} /></label>
    <label className="block text-sm font-semibold text-slate-700">Phone number<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={30} value={form.phone} onChange={update} className={inputClass} /></label>
    <label className="block text-sm font-semibold text-slate-700">Password<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={form.password} onChange={update} className={inputClass} /><span className="mt-1 block text-xs font-normal text-slate-500">Use at least 8 characters.</span></label>
    <label className="block text-sm font-semibold text-slate-700">Account type<select name="role" value={form.role} onChange={update} className={inputClass}><option value="CITIZEN">Citizen</option><option value="VOLUNTEER">Volunteer</option></select></label>
    {form.role === 'VOLUNTEER' && <label className="block text-sm font-semibold text-slate-700">Skills <span className="font-normal">(comma separated, optional)</span><input name="skills" value={form.skills} onChange={update} className={inputClass} placeholder="First aid, logistics" /></label>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <button disabled={loading} className={buttonClass}>{loading ? 'Creating account…' : 'Create account'}</button>
  </form><p className="mt-5 text-sm text-slate-600">Already registered? <Link className="font-semibold text-teal-800 hover:underline" to="/login">Sign in</Link></p></section></div></main>;
}

const inputClass = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100';
const buttonClass = 'w-full rounded-lg bg-teal-800 px-5 py-3 font-semibold text-white hover:bg-teal-900 disabled:cursor-wait disabled:opacity-60';
