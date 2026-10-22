import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/* Le segment site vit dans l'URL : /s/2/reservations (id du site) — l'URL
 * est indicative, jamais source de vérités : l'API filtre par le compte. */

export type SiteSeg = string; // id numérique du site ou 'reseau'

export const SITE_SECTIONS = ['agent', 'guide', 'responsable'];

/* Segment autorisé pour le compte donné : son site attaché, sinon réseau. */
export function allowedSeg(user: { site: number | null } | null, role: string | null): SiteSeg {
  if (user?.site && role && SITE_SECTIONS.includes(role)) return String(user.site);
  return 'reseau';
}

/* Préfixe du contexte site courant, ex. /s/2. Fallback réseau. */
export function siteBase(pathname: string): string {
  const m = pathname.match(/^\/s\/([^/]+)/);
  return m ? `/s/${m[1]}` : '/s/reseau';
}

/* Usage dans les écrans : const link = useSiteLink(); <Link to={link('/appels')}> */
export function useSiteLink(): (p: string) => string {
  const { pathname } = useLocation();
  const base = siteBase(pathname);
  return useCallback((p: string) => `${base}${p}`, [base]);
}
