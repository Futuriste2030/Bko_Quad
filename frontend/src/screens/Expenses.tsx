import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import SiteFilter from '../components/SiteFilter';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import { activeSiteId, createExpense, deleteEntry, downloadPdf, listEntries, listSites, todayISO, updateEntry, type Entry, type Site } from '../lib/api';
import { fcfa } from '../lib/format';

const CATS = [
  { v: 'carburant', label: 'Carburant' },
  { v: 'reparation', label: 'Réparation' },
  { v: 'loyer', label: 'Loyer' },
  { v: 'autre', label: 'Autre' },
];

/* Dépenses : écritures de sortie (et recettes manuelles hors réservation).
   Une écriture validée n'est jamais supprimée ; mois clos = impossible. */
export default function Expenses() {
  const { notify } = useToast();
  const [items, setItems] = useState<Entry[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState<'out' | 'in' | 'all'>('out');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(todayISO());
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [category, setCategory] = useState('carburant');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [site, setSite] = useState(() => {
    const id = activeSiteId();
    return id ? String(id) : '';
  });
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [reportBusy, setReportBusy] = useState(false);
  const [editItem, setEditItem] = useState<Entry | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [eDay, setEDay] = useState('');

  const [eCategory, setECategory] = useState('carburant');
  const [eLabel, setELabel] = useState('');
  const [eAmount, setEAmount] = useState('');
  const [eSite, setESite] = useState('');
  const [eReceipt, setEReceipt] = useState('');

  function load() {
    setLoading(true); setError('');
    Promise.all([listEntries(), listSites().catch(() => [] as Site[])])
      .then(([e, s]) => { setItems(e); setSites(s); if (s.length === 1) setSite((p) => p || String(s[0].id)); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const rows = useMemo(() => items.filter((e) =>
    (f === 'all' || e.direction === f) &&
    (!q.trim() || e.label.toLowerCase().includes(q.trim().toLowerCase()) || e.voucher.includes(q.trim())),
  ), [items, f, q]);

  const out = items.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
  const outCount = items.filter((e) => e.direction === 'out').length;

  async function submit(keepOpen = false) {
    const n = Number(amount);
    if (!label.trim()) { notify('warning', 'Libellé requis', 'Décrivez la dépense en une phrase.'); return; }
    if (!n || n < 1) { notify('warning', 'Montant invalide', 'Saisissez le montant en FCFA.'); return; }
    setBusy(true);
    try {
      const e = await createExpense({ day, direction, category, label: label.trim(), amount: Math.round(n), site: site ? Number(site) : undefined });
      if (e.queued) notify('warning', 'Écriture consignée hors ligne', `${fcfa(e.amount)} — en attente de synchronisation.`);
      else notify('success', 'Écriture enregistrée', `Bordereau ${e.voucher} — ${fcfa(e.amount)}.`);
      if (keepOpen) {
        setLabel(''); setAmount(''); setCategory('carburant');
      } else {
        setOpen(false); setLabel(''); setAmount(''); setCategory('carburant');
      }
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  function openEdit(e: Entry) {
    setEditItem(e);
    setEDay(e.date.slice(0, 10));
    setECategory(e.category);
    setELabel(e.label);
    setEAmount(String(e.amount));
    setESite(e.site ? String(e.site) : '');
    setEReceipt(e.receipt || '');
  }
  async function submitEdit() {
    if (!editItem) return;
    const n = Number(eAmount);
    if (!eLabel.trim()) { notify('warning', 'Libellé requis', 'Décrivez la dépense en une phrase.'); return; }
    if (!n || n < 1) { notify('warning', 'Montant invalide', 'Saisissez le montant en FCFA.'); return; }
    setEditBusy(true);
    try {
      await updateEntry(editItem.id, {
        date: eDay,
        category: eCategory,
        label: eLabel.trim(),
        amount: Math.round(n),
        site: eSite ? Number(eSite) : null,
        receipt: eReceipt.trim(),
      });
      notify('success', 'Écriture modifiée', `${editItem.voucher} — ${fcfa(n)}.`);
      setEditItem(null);
      load();
    } catch (e) { notify('error', 'Modification impossible', e instanceof Error ? e.message : ''); }
    finally { setEditBusy(false); }
  }
  async function handleDelete(e: Entry) {
    if (!window.confirm(`Supprimer l'écriture ${e.voucher} (${fcfa(e.amount)}) ?`)) return;
    try {
      await deleteEntry(e.id);
      notify('success', 'Écriture supprimée', `${e.voucher}.`);
      load();
    } catch (err) { notify('error', 'Suppression impossible', err instanceof Error ? err.message : ''); }
  }
  async function downloadReport() {
    setReportBusy(true);
    try {
      await downloadPdf(`/finance/recette/pdf/?months=${encodeURIComponent(reportMonth)}&direction=out`,
        `Recette_mensuelle_Depenses_${reportMonth}.pdf`);
      notify('success', 'Rapport téléchargé', 'Rapport des dépenses prêt.');
    } catch (e) { notify('error', 'Téléchargement impossible', e instanceof Error ? e.message : ''); }
    finally { setReportBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Dépenses"
        sub="Sorties de caisse tracées, bordereau mensuel automatique."
        actions={<button type="button" className="btn btn-accent" onClick={() => setOpen(true)}><Icon name="plus" size={18} />Dépense</button>}
      />
      <div className="kpi-grid">
        <div className="kpi featured"><span className="kpi-top">Dépenses (total)</span><span className="kpi-value num">{fcfa(out)}</span><span className="kpi-sub">{outCount} écritures</span></div>
      </div>
      <div className="card">
        <div className="form-2">
          <div className="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher libellé ou bordereau…" aria-label="Rechercher une écriture" />
          </div>
          <div className="segmented" role="group" aria-label="Filtrer par sens">
            {([['out', 'Dépenses'], ['in', 'Recettes manuelles'], ['all', 'Tous']] as const).map(([v, l]) => (
              <button key={v} type="button" className="chip" aria-pressed={f === v} onClick={() => setF(v)}>{l}</button>
            ))}
          </div>
          <SiteFilter />
        </div>
        <div className="form-2" style={{ marginTop: 8 }}>
          <Field label="Mois du rapport" htmlFor="rep-month">
            <input id="rep-month" type="month" value={reportMonth} onChange={(e) => e.target.value && setReportMonth(e.target.value)} />
          </Field>
          <Field label="Télécharger le rapport" htmlFor="rep-btn">
            <button type="button" className="btn btn-primary" onClick={downloadReport} disabled={reportBusy}>
              {reportBusy && <span className="caret" aria-hidden="true" />}Rapport dépenses (PDF)
            </button>
          </Field>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Les recettes automatiques des réservations vivent dans la Caisse, pas ici.</p>
      </div>
      {editItem && (
        <div className="modal-backdrop" onClick={() => !editBusy && setEditItem(null)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Modifier l'écriture" onClick={(e) => e.stopPropagation()}>
            <h2>Modifier l'écriture</h2>
            <p className="small muted">Bordereau {editItem.voucher} — le bordereau reste inchangé. Mois clos = modification impossible.</p>
            <div className="form-2">
              <Field label="Date" required htmlFor="ex-day">
                <input id="ex-day" type="date" value={eDay} onChange={(e) => setEDay(e.target.value)} />
              </Field>
              <Field label="Catégorie" required htmlFor="ex-cat">
                <select id="ex-cat" value={eCategory} onChange={(e) => setECategory(e.target.value)}>
                  {CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Site (optionnel)" htmlFor="ex-site">
              <select id="ex-site" value={eSite} onChange={(e) => setESite(e.target.value)}>
                <option value="">—</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Libellé" required htmlFor="ex-label">
              <input id="ex-label" value={eLabel} onChange={(e) => setELabel(e.target.value)} />
            </Field>
            <Field label="Montant (FCFA)" required htmlFor="ex-amount">
              <input id="ex-amount" inputMode="numeric" value={eAmount} onChange={(e) => setEAmount(e.target.value)} />
            </Field>
            <Field label="Réf. justificatif (optionnel)" htmlFor="ex-receipt">
              <input id="ex-receipt" value={eReceipt} onChange={(e) => setEReceipt(e.target.value)} />
            </Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditItem(null)} disabled={editBusy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submitEdit} disabled={editBusy}>
                {editBusy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="wallet" title="Aucune écriture" text="Les dépenses saisies apparaîtront ici, jamais supprimées." />
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
                <span>{CATS.find((c) => c.v === e.category)?.label ?? e.category}</span>
                {e.site_name && <span>{e.site_name}</span>}
                {e.locked && <span>Verrouillée</span>}
              </div>
              <div className="row-top">
                <strong className="num">{fcfa(e.amount)}</strong>
                {!e.locked && (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(e)} aria-label="Modifier l'écriture">
                      Modifier
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDelete(e)} aria-label="Supprimer l'écriture">
                      Supprimer
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouvelle dépense" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle écriture</h2>
            <div className="form-2">
              <Field label="Date" required htmlFor="ex-day"><input id="ex-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
              <Field label="Sens" required htmlFor="ex-dir">
                <select id="ex-dir" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
                  <option value="out">Dépense (sortie)</option>
                  <option value="in">Recette manuelle (entrée)</option>
                </select>
              </Field>
            </div>
            <div className="form-2">
              <Field label="Catégorie" required htmlFor="ex-cat">
                <select id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="Site (optionnel)" htmlFor="ex-site">
                <select id="ex-site" value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">—</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Libellé" required htmlFor="ex-label"><input id="ex-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. gasoil groupe électrogène" /></Field>
            <Field label="Montant (FCFA)" required htmlFor="ex-amount"><input id="ex-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex. 15000" /></Field>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-ghost" onClick={() => submit(true)} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer et ajouter
              </button>
              <button type="button" className="btn btn-primary" onClick={() => submit(false)} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
