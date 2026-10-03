import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { authApi } from '../services/api.js';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const registered = location.state?.registered;
  if (auth.isAuthenticated) return <Navigate to={location.state?.from || '/'} replace />;

  async function submit(event) {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const result = await authApi.login({ phone: phone.trim(), password });
      auth.signIn(result);
      navigate(location.state?.from || '/', { replace: true });
    } catch (cause) { setError(cause.message); }
    finally { setLoading(false); }
  }

  return <AuthPage title="Welcome back" subtitle="Sign in to your ResQ account.">
    <form onSubmit={submit} className="space-y-5">
      {registered && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Account created. Sign in with your phone number and password.</p>}
      <Field label="Phone number" id="phone"><input id="phone" autoComplete="tel" required minLength={7} maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="Your registered phone number" /></Field>
      <Field label="Password" id="password"><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="Your password" /></Field>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button disabled={loading} className={buttonClass}>{loading ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p className="mt-6 text-sm text-slate-600">New to ResQ? <Link className="font-semibold text-teal-800 hover:underline" to="/register">Create an account</Link></p>
  </AuthPage>;
}

const inputClass = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100';
const buttonClass = 'w-full rounded-lg bg-teal-800 px-5 py-3 font-semibold text-white hover:bg-teal-900 disabled:cursor-wait disabled:opacity-60';
function Field({ label, id, children }) { return <label htmlFor={id} className="block text-sm font-semibold text-slate-700">{label}{children}</label>; }
function AuthPage({ title, subtitle, children }) { return <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900"><div className="mx-auto max-w-md"><Link to="/" className="text-2xl font-bold text-teal-800">ResQ<span className="text-orange-500">.</span></Link><section className="mt-8 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-2 mb-6 text-slate-600">{subtitle}</p>{children}</section></div></main>; }
