import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { listSites, type Site } from '../lib/api';
import { useAuth } from '../lib/auth';
import { siteBase } from '../lib/sitepath';
import { Field } from './ui';

export default function SiteFilter({ hint }: { hint?: string }) {
  const { user, role } = useAuth();
  const loc = useLocation();
  const [sites, setSites] = useState<Site[]>([]);
  const canSwitch = role === 'admin' || role === 'superadmin' || role === 'comptable';
  const base = siteBase(loc.pathname);
  const seg = base === '/s/reseau' ? 'reseau' : base.slice(3);
  const label = base === '/s/reseau'
    ? 'Tout le réseau'
    : (sites.find((s) => String(s.id) === seg)?.name || user?.site_name || `Site ${seg}`);

  useEffect(() => {
    let alive = true;
    listSites()
      .then((rows) => { if (alive) setSites(rows); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  return (
    <Field
      label="Site"
      htmlFor="site-filter"
      hint={hint ?? (canSwitch
        ? 'Filtré par le sélecteur de site en haut.'
        : 'Fixe : votre site.')}
    >
      <select id="site-filter" value={seg} disabled>
        <option value={seg}>{label}</option>
      </select>
    </Field>
  );
}
