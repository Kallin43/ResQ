import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AuthorityDashboard from './pages/AuthorityDashboard.jsx';
import CitizenDashboard from './pages/CitizenDashboard.jsx';
import FacilitiesPage from './pages/FacilitiesPage.jsx';
import Login from './pages/Login.jsx';
import ReportIncident from './pages/ReportIncident.jsx';
import Register from './pages/Register.jsx';

function HomePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold tracking-tight text-teal-800">
            ResQ<span className="text-orange-500">.</span>
          </Link>
          <div className="flex items-center gap-3">
            {auth.isAuthenticated ? <>
              <span className="text-sm text-slate-600">{auth.user?.name || auth.user?.role} · {auth.user?.role}</span>
              {auth.user?.role === 'CITIZEN' && <Link to="/citizen" className="text-sm font-semibold text-teal-800">Citizen Dashboard</Link>}
              {(auth.user?.role === 'AUTHORITY' || auth.user?.role === 'ADMIN') && <Link to="/authority" className="text-sm font-semibold text-teal-800">Authority Dashboard</Link>}
              <button onClick={() => { auth.logout(); navigate('/'); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Log out</button>
            </> : <>
              <Link to="/login" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Log in</Link>
              <Link to="/register" className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white">Register</Link>
            </>}
          </div>
        </header>

        <section className="mt-20 max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-700">
            Ready to coordinate
          </p>
          <h1 className="mt-5 text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
            Relief starts with a clearer picture.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            ResQ is a shared space for reporting emergencies and coordinating
            people, facilities, and supplies during a disaster.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button className="rounded-lg bg-teal-800 px-5 py-3 font-semibold text-white shadow-sm">
              Report an emergency
            </button>
            <button className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700">
              View nearby facilities
            </button>
            {auth.isAuthenticated && (auth.user?.role === 'AUTHORITY' || auth.user?.role === 'ADMIN') && <Link to="/authority" className="rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700">Authority dashboard</Link>}
          </div>
          <p className="mt-5 text-sm text-slate-500">
            Starter homepage — application workflows will be added in later phases.
          </p>
        </section>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/citizen" element={<ProtectedRoute roles={['CITIZEN']}><CitizenDashboard /></ProtectedRoute>} />
      <Route path="/authority" element={<ProtectedRoute roles={['AUTHORITY', 'ADMIN']}><AuthorityDashboard /></ProtectedRoute>} />
      <Route path="/report" element={<ProtectedRoute roles={['CITIZEN']}><ReportIncident /></ProtectedRoute>} />
      <Route path="/facilities" element={<ProtectedRoute><FacilitiesPage /></ProtectedRoute>} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}

function PlaceholderPage({ title }) {
  return <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900"><div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><Link to="/citizen" className="text-sm font-semibold text-teal-800">← Citizen dashboard</Link><h1 className="mt-6 text-3xl font-bold">{title}</h1><p className="mt-3 text-slate-600">This page will be implemented in a later phase.</p></div></main>;
}
