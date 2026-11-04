'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiError, type ApiClient } from './api';
import { Spinner } from './components';

export interface Me {
  id: string;
  accountType: 'APPLICANT' | 'VERIFIER' | 'INSTITUTION' | 'ADMIN';
  fullName: string;
  email: string | null;
  phone: string | null;
  isGuest: boolean;
  mfaEnabled: boolean;
  timezone: string;
  scopeRequestId: string | null;
  adminRole: string | null;
  adminPermissions: string[];
  organisation: { id: string; legalName: string; tradingName: string | null; status: string; role: string; permissions: string[] } | null;
  verifier: { id: string; status: string } | null;
  notificationPrefs: { email?: boolean; sms?: boolean; push?: boolean };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  client: ApiClient;
  can: (perm: string) => boolean;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setMe(await client.get<Me>('/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setMe(null);
    } finally {
      setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const logout = useCallback(async () => {
    await client.post('/auth/logout').catch(() => undefined);
    setMe(null);
    window.location.href = '/sign-in';
  }, [client]);
  const can = useCallback((perm: string) => !!me && (me.adminPermissions.includes(perm) || !!me.organisation?.permissions.includes(perm)), [me]);
  return <Ctx.Provider value={{ me, loading, refresh, logout, client, can }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Client-side guard for UX only — every API route enforces authorisation server-side. */
export function RequireAuth({ children, signInPath = '/sign-in' }: { children: ReactNode; signInPath?: string }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!loading && !me) router.replace(`${signInPath}?next=${encodeURIComponent(path)}`);
  }, [loading, me, router, path, signInPath]);
  if (loading || !me) return <Spinner label="Checking your session" />;
  return <>{children}</>;
}
