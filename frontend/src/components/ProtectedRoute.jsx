import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function ProtectedRoute({ children, roles }) {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(auth.user?.role)) return <Navigate to="/" replace />;
  return children;
}
