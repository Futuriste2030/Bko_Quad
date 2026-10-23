import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { listSites, type Site } from '../lib/api';
import { useAuth } from '../lib/auth';
import { siteBase } from '../lib/sitepath';
import { Field } from './ui';

export default function SiteFilter({ hint }: { hint?: string }) {
  const { user, role } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [sites, setSites] = useState<Site[]>([]);
  const base = siteBase(loc.pathname);
  const seg = base === '/s/reseau' ? 'reseau' : base.slice(3);
  const canSwitch = role === 'admin' || role === 'superadmin' || role === 'comptable';

  useEffect(() => {
    let alive = true;
    listSites()
      .then((rows) => { if (alive) setSites(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  function change(next: string) {
    if (next === seg) return;
    const rest = loc.pathname.replace(/^\/s\/[^/]+/, '') || '';
    nav(`/s/${next}${rest}${loc.search}`);
  }

  return (
    <Field
      label="Site"
      htmlFor="site-filter"
      hint={canSwitch ? (hint ?? 'Filtre les données de cet écran.') : 'Verrouillé sur votre site.'}
    >
      <select
        id="site-filter"
        value={seg}
        onChange={(e) => change(e.target.value)}
        disabled={!canSwitch}
      >
        {canSwitch && <option value="reseau">Tout le réseau</option>}
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{s.city ? ` - ${s.city}` : ''}
          </option>
        ))}
        {!canSwitch && sites.length === 0 && (
          <option value={seg}>{user?.site_name || 'Mon site'}</option>
        )}
      </select>
    </Field>
  );
}
