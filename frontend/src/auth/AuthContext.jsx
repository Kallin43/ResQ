import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext(null);

function readSession() {
  const token = sessionStorage.getItem('resq_token');
  if (!token) return { token: null, user: null };
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
    if (!claims.exp || claims.exp * 1000 <= Date.now()) throw new Error('Expired token');
    const savedUser = JSON.parse(sessionStorage.getItem('resq_user') || 'null');
    return { token, user: savedUser ?? { id: claims.sub, role: claims.role, name: '' } };
  } catch {
    sessionStorage.removeItem('resq_token');
    sessionStorage.removeItem('resq_user');
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);
  const logout = useCallback(() => {
    sessionStorage.removeItem('resq_token');
    sessionStorage.removeItem('resq_user');
    setSession({ token: null, user: null });
  }, []);
  const signIn = useCallback(({ token, user }) => {
    sessionStorage.setItem('resq_token', token);
    sessionStorage.setItem('resq_user', JSON.stringify(user));
    setSession({ token, user });
  }, []);

  useEffect(() => {
    window.addEventListener('resq:unauthorized', logout);
    return () => window.removeEventListener('resq:unauthorized', logout);
  }, [logout]);

  const value = useMemo(() => ({ ...session, signIn, logout, isAuthenticated: Boolean(session.token) }), [session, signIn, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
