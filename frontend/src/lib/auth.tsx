import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cachedMe, fetchMe, isLoggedIn, login as apiLogin, logout as apiLogout, NetworkError, type Me } from './api';

export type Role = 'agent' | 'guide' | 'responsable' | 'admin' | 'superadmin' | 'comptable' | 'client';

export const ROLE_LABELS: Record<Role, string> = {
  agent: 'Agent de réservation',
  guide: 'Guide',
  responsable: "Responsable d'agence",
  admin: 'Direction / admin',
  superadmin: 'Super administrateur (système)',
  comptable: 'Comptable',
  client: 'Client',
};

interface Auth {
  user: Me | null;
  role: Role | null;
  ready: boolean;
  login: (u: string, p: string, otp?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<Auth>({
  user: null, role: null, ready: false,
  login: async () => undefined, logout: () => undefined,
  refresh: async () => undefined, can: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { setReady(true); return; }
    fetchMe()
      .then(setUser)
      .catch((e: unknown) => {
        /* J : hors ligne, le profil en cache garde la session ouverte et les
           saisies en file restent rejouables. */
        if (e instanceof NetworkError) {
          const cached = cachedMe();
          if (cached) { setUser(cached); return; }
        }
        apiLogout();
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (u: string, p: string, otp = '') => {
    await apiLogin(u, p, otp);
    try { setUser(await fetchMe()); } catch { setUser(null); }
  }, []);

  const logout = useCallback(() => { apiLogout(); setUser(null); }, []);
  const refresh = useCallback(async () => {
    try { setUser(await fetchMe()); } catch { /* session expirée : le garde redirige */ }
  }, []);
  /* Le compte système reste superadmin même si son champ `role` a été
     modifié directement en base : `is_superuser` fait foi côté interface. */
  const role: Role | null = user?.is_superuser
    ? 'superadmin'
    : ((user?.role as Role | undefined) ?? null);
  const can = useCallback((...roles: Role[]) => {
    if (!role) return false;
    if (user?.is_superuser || role === 'admin' || role === 'superadmin') return true;
    return roles.includes(role);
  }, [role, user?.is_superuser]);

  return <Ctx.Provider value={{ user, role, ready, login, logout, refresh, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
