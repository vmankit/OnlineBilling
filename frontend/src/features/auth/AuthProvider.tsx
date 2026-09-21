import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, SESSION_EXPIRED_EVENT, tokenStore } from '@/lib/api';

export type RoleCode = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: RoleCode;
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<void>;
  loginWithPin: (pin: string) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Restore the session on boot so a refresh (or reopening the home-screen
  // app) does not force another sign-in.
  useEffect(() => {
    if (!tokenStore.get()) {
      setStatus('anonymous');
      return;
    }
    api
      .get<{ user: AuthUser }>('/api/auth/me')
      .then(({ user: me }) => {
        setUser(me);
        setStatus('authenticated');
      })
      .catch(() => {
        tokenStore.clear();
        setStatus('anonymous');
      });
  }, []);

  useEffect(() => {
    const handler = (): void => logout();
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/api/auth/login', { email, password });
    tokenStore.set(res.token);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const loginWithPin = useCallback(async (pin: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/api/auth/pin-login', { pin });
    tokenStore.set(res.token);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const can = useCallback(
    (permission: string) =>
      !!user && (user.permissions.includes('*') || user.permissions.includes(permission)),
    [user],
  );

  const value = useMemo(
    () => ({ user, status, login, loginWithPin, logout, can }),
    [user, status, login, loginWithPin, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
