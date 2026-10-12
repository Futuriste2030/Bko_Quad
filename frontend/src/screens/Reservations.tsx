import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { EmptyState, IconButton, PageHeader, SkeletonList } from '../components/ui';
import { useToast } from '../lib/toast';
import Icon from '../lib/icons';
import { cancelBooking, listBookings, type Booking } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';

const FILTERS = [
  { v: 'all', label: 'Toutes' },
  { v: 'pending_deposit', label: 'Attente acompte' },
  { v: 'confirmed', label: 'Confirmées' },
  { v: 'checked_in', label: 'Arrivées' },
  { v: 'completed', label: 'Terminées' },
  { v: 'cancelled', label: 'Annulées' },
];

export default function Reservations() {
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const [toCancel, setToCancel] = useState<Booking | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  function load() {
    setLoading(true); setError('');
    listBookings().then(setItems).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const rows = useMemo(() => items.filter((b) =>
    (f === 'all' || b.status === f) &&
    (!q.trim() || b.code.toLowerCase().includes(q.trim().toLowerCase())),
  ), [items, f, q]);

  async function doCancel() {
    if (!toCancel) return;
    if (!reason.trim()) { notify('warning', 'Motif obligatoire', 'Précisez le motif d’annulation pour tracer.'); return; }
    setBusy(true);
    try {
      await cancelBooking(toCancel.id, reason.trim());
      notify('success', 'Réservation annulée', `${toCancel.code} — motif tracé.`);
      setToCancel(null); setReason('');
      load();
    } catch (e) { notify('error', 'Annulation impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Réservations"
        sub="Cartes sur mobile, tableau détaillé sur ordinateur. Motif obligatoire pour toute annulation."
        actions={<Link to="/reservations/nouvelle" className="btn btn-accent"><Icon name="plus" size={18} />Nouvelle réservation</Link>}
      />
      <div className="card">
        <div className="form-2">
          <div className="search">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un code (BKO-…)" aria-label="Rechercher une réservation" />
          </div>
          <div className="segmented" role="group" aria-label="Filtrer par statut">
            {FILTERS.map((x) => (
              <button key={x.v} type="button" className="chip" aria-pressed={f === x.v} onClick={() => setF(x.v)}>{x.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="ticket" title="Aucune réservation" text="Touchez « Nouvelle réservation » pour commencer."
          action={<Link to="/reservations/nouvelle" className="btn btn-primary">Nouvelle réservation</Link>} />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="list only-mobile">
            {rows.map((b) => (
              <article className="row-card" key={b.id}>
                <div className="row-top">
                  <span className="stub row-title num">{b.code}</span>
                  <StatusBadge status={b.status} />
                </div>
                <div className="row-meta">
                  <span className="num">{fmtSlot(b.expires_at)}</span>
                  <span className="num">{b.persons} pers. · {b.quads} quad{b.quads > 1 ? 's' : ''}</span>
                </div>
                <div className="row-top">
                  <strong className="num">{fcfa(b.total)}</strong>
                  <span className="small muted num">Reste dû : {fcfa(Math.max(0, b.total - b.deposit_due))}</span>
                  {b.status !== 'cancelled' && (
                    <IconButton icon="x" label={`Annuler ${b.code}`} className="danger plain" onClick={() => setToCancel(b)} />
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="table-wrap only-desktop">
            <table className="table">
              <thead><tr><th>Code</th><th>Créneau</th><th>Personnes</th><th>Total</th><th>Reste dû</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="num"><strong>{b.code}</strong></td>
                    <td className="num">{fmtSlot(b.expires_at)}</td>
                    <td className="num">{b.persons} · {b.quads} quads</td>
                    <td className="num">{fcfa(b.total)}</td>
                    <td className="num">{fcfa(Math.max(0, b.total - b.deposit_due))}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>{b.status !== 'cancelled' && <IconButton icon="x" label={`Annuler ${b.code}`} className="danger plain" onClick={() => setToCancel(b)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {toCancel && (
        <div className="modal-backdrop" onClick={() => { if (!busy) { setToCancel(null); setReason(''); } }}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-label={`Annuler ${toCancel.code}`} onClick={(e) => e.stopPropagation()}>
            <h2>Annuler {toCancel.code} ?</h2>
            <p>L’annulation est tracée (qui, quand, avant, après). Un motif est obligatoire.</p>
            <div className="field">
              <label htmlFor="cancel-reason">Motif d’annulation (obligatoire)</label>
              <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Ex. client indisponible, pluie, double saisie" />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setToCancel(null); setReason(''); }} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-danger" onClick={doCancel} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}
                Confirmer l’annulation
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
