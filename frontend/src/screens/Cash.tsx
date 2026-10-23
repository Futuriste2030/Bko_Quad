import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import SiteFilter from '../components/SiteFilter';
import { EmptyState, Field, PageHeader, Portal, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { activeSiteId, createExpense, listBookings, listEntries, listSites, type Booking, type Entry, type Site } from '../lib/api';
import { fcfa } from '../lib/format';

/* Caisse : le livre unique — recettes auto + recettes manuelles (ancien),
   dépenses saisies. Ã‰criture validée jamais supprimée, mois clos verrouillé. */
const DIRS = [
  { v: 'all', label: 'Tous' },
  { v: 'in', label: 'Recettes' },
  { v: 'out', label: 'Dépenses' },
];

const CATS: Record<string, string> = {
  recette_reservation: 'Recette réservation',
  recette_manuelle: 'Recette manuelle (ancien)',
  carburant: 'Carburant',
  reparation: 'Réparation',
  salaire: 'Salaire',
  avance: 'Avance',
  loyer: 'Loyer',
  autre: 'Autre',
};

export default function Cash() {
  const link = useSiteLink();
  const { can } = useAuth();
  const { notify } = useToast();
  const mayWrite = can('responsable', 'admin');
  const [items, setItems] = useState<Entry[]>([]);
  const [codes, setCodes] = useState<Record<number, string>>({});
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rDate, setRDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rLabel, setRLabel] = useState('');
  const [rAmount, setRAmount] = useState('');
  const [rSite, setRSite] = useState(() => {
    const id = activeSiteId();
    return id ? String(id) : '';
  });
  const [rReceipt, setRReceipt] = useState('');

  function load() {
  setLoading(true); setError('');
    Promise.all([listEntries(), listBookings().catch(() => [] as Booking[]), listSites().catch(() => [] as Site[])])
      .then(([e, b, s]) => {
        setItems(e);
        const m: Record<number, string> = {};
        for (const r of b) m[r.id] = r.code;
        setCodes(m); setSites(s);
        if (s.length === 1) setRSite((p) => p || String(s[0].id));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const rows = useMemo(() => items.filter((e) =>
    (f === 'all' || e.direction === f) &&
    (!q.trim() || e.label.toLowerCase().includes(q.trim().toLowerCase()) || e.voucher.includes(q.trim())),
  ), [items, f, q]);

  const inn = rows.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
  const out = rows.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);

  /* Ancienne recette (hors Hub) : date passée autorisée, bordereau auto du mois saisi. */
  async function submitReceipt() {
  if (!rLabel.trim()) { notify('warning', 'Libellé requis', 'Décrivez la recette (ex. espèces septembre).'); return; }
    const n = Math.round(Number(rAmount));
    if (!n || n < 1) { notify('warning', 'Montant invalide', 'Saisissez le montant en FCFA.'); return; }
    if (!rDate) { notify('warning', 'Date requise', 'La date d’encaissement réel.'); return; }
    setBusy(true);
    try {
      const e = await createExpense({
        day: rDate, direction: 'in', category: 'recette_manuelle',
        label: rLabel.trim(), amount: n,
        ...(rSite ? { site: Number(rSite) } : {}),
        ...(rReceipt.trim() ? { receipt: rReceipt.trim() } : {}),
      });
      if (e.queued) notify('warning', 'Recette consignée hors ligne', `${fcfa(n)} — écriture en attente de synchronisation.`);
      else notify('success', 'Recette enregistrée', `${e.voucher} — ${fcfa(n)}.`);
      setOpen(false); setRLabel(''); setRAmount(''); setRSite(''); setRReceipt('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Caisse"
        sub="Livre unique : recettes automatiques + anciennes recettes saisies, dépenses, bordereau mensuel."
        actions={(
          <>
            {mayWrite && (
              <button type="button" className="btn btn-primary" onClick={() => { setOpen(true); setRDate(new Date().toISOString().slice(0, 10)); }}>
                <Icon name="plus" size={18} />Recette
              </button>
            )}
            <Link to={link('/depenses')} className="btn btn-accent"><Icon name="plus" size={18} />Dépense</Link>
          </>
        )}
      />
      <div className="kpi-grid">
        <div className="kpi featured"><span className="kpi-top">Recettes (filtre)</span><span className="kpi-value num">{fcfa(inn)}</span></div>
        <div className="kpi"><span className="kpi-top">Dépenses (filtre)</span><span className="kpi-value num">{fcfa(out)}</span></div>
      </div>
      <div className="card">
        <div className="form-2">
          <div className="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher libellé ou bordereau…" aria-label="Rechercher une écriture" />
          </div>
          <div className="segmented" role="group" aria-label="Filtrer par sens">
            {DIRS.map((x) => (
              <button key={x.v} type="button" className="chip" aria-pressed={f === x.v} onClick={() => setF(x.v)}>{x.label}</button>
            ))}
          </div>
          <SiteFilter />
        </div>
      </div>
      {loading && <SkeletonList n={3} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="wallet" title="Aucune écriture" text="Les règlements, anciennes recettes et dépenses apparaîtront ici, avec leur bordereau." />
      )}
      {open && (
        <Portal><div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Ancienne recette" onClick={(e) => e.stopPropagation()}>
            <h2>Ancienne recette (manuelle)</h2>
            <p className="small muted">Encaissement d’avant le Hub : date réelle, bordereau auto du mois saisi. Mois clos = impossible.</p>
            <div className="form-2">
              <Field label="Date d’encaissement" required htmlFor="cx-date">
                <input id="cx-date" type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} />
              </Field>
              <Field label="Montant (FCFA)" required htmlFor="cx-amount">
                <input id="cx-amount" inputMode="numeric" value={rAmount} onChange={(e) => setRAmount(e.target.value)} placeholder="Ex. 150000" />
              </Field>
            </div>
            <Field label="Libellé" required htmlFor="cx-label">
              <input id="cx-label" value={rLabel} onChange={(e) => setRLabel(e.target.value)} placeholder="Ex. espèces fin septembre" />
            </Field>
            <div className="form-2">
              <Field label="Site" htmlFor="cx-site">
                <select id="cx-site" value={rSite} onChange={(e) => setRSite(e.target.value)}>
                  <option value="">—</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Réf. justificatif (optionnel)" htmlFor="cx-receipt" hint="Carnet, reçu papier…">
                <input id="cx-receipt" value={rReceipt} onChange={(e) => setRReceipt(e.target.value)} placeholder="Ex. ANC-001" />
              </Field>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitReceipt} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer la recette
              </button>
            </div>
          </div>
        </div></Portal>
      )}
      {!loading && !error && (
        <div className="list">
          {rows.map((e) => (
            <article className="row-card" key={e.id}>
              <div className="row-top">
                <span className="row-title num">{e.voucher}</span>
                <span className={`badge ${e.direction === 'in' ? 'badge-confirmed' : 'badge-pending_deposit'}`}>
                  {e.direction === 'in' ? 'Recette' : 'Dépense'}
                </span>
              </div>
              <div>{e.label}</div>
              <div className="row-meta">
                <span className="num">{new Date(e.date).toLocaleDateString('fr-FR')}</span>
                <span>{CATS[e.category] ?? e.category}</span>
                {e.site_name && <span>{e.site_name}</span>}
                {e.receipt && <span className="num">Réf {e.receipt}</span>}
                {e.booking != null && codes[e.booking] && <span className="num">{codes[e.booking]}</span>}
                {e.locked && <span>Verrouillée</span>}
              </div>
              <div className="row-top"><strong className="num">{fcfa(e.amount)}</strong></div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
