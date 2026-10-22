import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getCompany, type Company } from './api';

const DEFAULTS: Company = {
  id: 0, name: 'BKO Quad', phone: '', email: '', address: 'Bamako, Mali',
  nif: '', rccm: '', conditions: '',   thanks: 'Merci de votre confiance.',
  stamp: null, signature: null, signature_name: '',
};

const Ctx = createContext<{ company: Company; refresh: () => Promise<void> }>({
  company: DEFAULTS, refresh: async () => undefined,
});

/* Fiche entreprise : en-têtes et pieds des documents (reçu, facture, rapports). */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<Company>(DEFAULTS);

  const refresh = useCallback(async () => {
    try { setCompany(await getCompany()); } catch { /* hors-ligne : valeurs par défaut */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return <Ctx.Provider value={{ company, refresh }}>{children}</Ctx.Provider>;
}

export const useCompany = () => useContext(Ctx);
