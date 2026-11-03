import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import SiteFilter from '../components/SiteFilter';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { activeSiteId, createExpense, listEntries, listSites, todayISO, type Entry, type Site } from '../lib/api';
import { fcfa } from '../lib/format';

const TYPES = [
  { v: 'declaration', label: 'Déclaration mensuelle' },
  { v: 'patente', label: 'Patente (CA)' },
];

export default function Impots() {
  const { notify } = useToast();
  const [items, setItems] = useState<Entry[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState('declaration');
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [site, setSite] = useState(() => {
    const id = activeSiteId();
    return id ? String(id) : '';
  });

  function load() {
    setLoading(true); setError('');
    Promise.all([listEntries(), listSites().catch(() => [] as Site[])])
      .then(([e, s]) => {
        setItems(e); setSites(s);
        if (s.length === 1) setSite((p) => p || String(s[0].id));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const impots = useMemo(() => items.filter((e) => e.category === 'impot' && e.direction === 'out'), [items]);
  const total = impots.reduce((s, e) => s + e.amount, 0);

  const monthRevenue = useMemo(() => {
    return items
      .filter((e) => e.direction === 'in' && e.date.slice(0, 7) === month)
      .reduce((s, e) => s + e.amount, 0);
  }, [items, month]);

  async function submit() {
    const n = Number(amount);
    if (!label.trim()) { notify('warning', 'Libellé requis', 'Décrivez l\'impôt.'); return; }
    if (!n || n < 1) { notify('warning', 'Montant invalide', 'Saisissez le montant en FCFA.'); return; }
    setBusy(true);
    try {
      const e = await createExpense({
        day: `${month}-01`, direction: 'out', category: 'impot',
        label: label.trim(), amount: Math.round(n),
        site: site ? Number(site) : undefined,
      });
      notify('success', 'Impôt enregistré', `Bordereau ${e.voucher} — ${fcfa(e.amount)}.`);
      setOpen(false); setLabel(''); setAmount('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Impôts"
        sub="Déclarations mensuelles et patentes, déduits de la caisse."
        actions={<button type="button" className="btn btn-accent" onClick={() => setOpen(true)}><Icon name="plus" size={18} />Nouvel impôt</button>}
      />
      <div className="kpi-grid">
        <div className="kpi featured"><span className="kpi-top">Impôts enregistrés</span><span className="kpi-value num">{fcfa(total)}</span><span className="kpi-sub">{impots.length} écriture(s)</span></div>
      </div>
      <div className="card">
        <div className="form-2">
          <SiteFilter />
        </div>
      </div>
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && impots.length === 0 && (
        <EmptyState icon="wallet" title="Aucun impôt" text="Les déclarations et patentes apparaîtront ici." />
      )}
      {!loading && !error && impots.length > 0 && (
        <div className="list">
          {impots.map((e) => (
            <article className="row-card" key={e.id}>
              <div className="row-top">
                <span className="row-title num">{e.voucher}</span>
                <span className="badge badge-pending_deposit">Impôt</span>
              </div>
              <div>{e.label}</div>
              <div className="row-meta">
                <span className="num">{new Date(e.date).toLocaleDateString('fr-FR')}</span>
                {e.site_name && <span>{e.site_name}</span>}
              </div>
              <div className="row-top"><strong className="num">{fcfa(e.amount)}</strong></div>
            </article>
          ))}
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouvel impôt" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvel impôt</h2>
            <div className="form-2">
              <Field label="Type" required htmlFor="imp-type">
                <select id="imp-type" value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Mois" required htmlFor="imp-month">
                <input id="imp-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
              </Field>
            </div>
            <div className="form-2">
              <Field label="Montant (FCFA)" required htmlFor="imp-amount">
                <input id="imp-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex. 50000" />
              </Field>
              <Field label="Site (optionnel)" htmlFor="imp-site">
                <select id="imp-site" value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">—</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            {type === 'patente' && (
              <p className="small muted">Recettes du mois sélectionné : {fcfa(monthRevenue)} — base pour la patente.</p>
            )}
            <Field label="Libellé" required htmlFor="imp-label">
              <input id="imp-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={type === 'declaration' ? 'Ex. Déclaration mensuelle octobre 2026' : 'Ex. Patente annuelle'} />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}