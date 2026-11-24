import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, onUnauthenticated } from '@/lib/api';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  /** Resolves with a challenge when a two-factor code is needed next. */
  login: (username: string, password: string) => Promise<{ mfaChallenge?: string }>;
  verifyMfa: (challenge: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((r) => {
        setUser(r.user);
        setStatus('authenticated');
      })
      .catch(() => setStatus('anonymous'));
  }, []);

  useEffect(
    () =>
      onUnauthenticated(() => {
        setUser(null);
        setStatus('anonymous');
        qc.clear();
      }),
    [qc],
  );

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ user?: User; mfaRequired?: boolean; challenge?: string }>('/auth/login', { method: 'POST', body: { username, password } });
    if (r.mfaRequired && r.challenge) return { mfaChallenge: r.challenge };
    setUser(r.user!);
    setStatus('authenticated');
    return {};
  }, []);

  const verifyMfa = useCallback(async (challenge: string, code: string) => {
    const r = await api<{ user: User }>('/auth/mfa/verify', { method: 'POST', body: { challenge, code } });
    setUser(r.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  const value = useMemo(() => ({ user, status, login, verifyMfa, logout }), [user, status, login, verifyMfa, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };
