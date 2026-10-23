import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { ConfirmDialog, EmptyState, IconButton, PageHeader, SkeletonList } from '../components/ui';
import { useToast } from '../lib/toast';
import Icon from '../lib/icons';
import {
  cancelBooking, checkInBooking, completeBooking, expireBooking, listActivities, listBookingEvents, listBookings, listSlots, noShowBooking,
  type Activity, type Booking, type BookingEventItem, type Slot,
} from '../lib/api';
import { fmtCountdown, getRide, remainingMs, rideFromCheckin, useNow, type Ride } from '../lib/ride';
import { useSync } from '../lib/sync';
import { fcfa, fmtSlot } from '../lib/format';

const FILTERS = [
  { v: 'all', label: 'Toutes' },
  { v: 'pending_deposit', label: 'En attente' },
  { v: 'confirmed', label: 'Confirmées' },
  { v: 'checked_in', label: 'Arrivées' },
  { v: 'completed', label: 'Terminées' },
  { v: 'cancelled', label: 'Annulées' },
];

type Act = { kind: 'checkin' | 'complete' | 'noshow' | 'expire'; b: Booking };
const ACT_TEXT: Record<Act['kind'], { title: (c: string) => string; text: string; ok: string }> = {
  checkin: { title: (c) => `Valider l’arrivée de ${c} ?`, text: 'Le talon est consommé : un second passage sera refusé.', ok: 'Valider l’arrivée' },
  complete: { title: (c) => `Terminer ${c} ?`, text: 'La sortie est clôturée après le retour des quads.', ok: 'Terminer la sortie' },
  noshow: { title: (c) => `Marquer ${c} absent ?`, text: 'Le client ne s’est pas présenté, le créneau est libéré.', ok: 'Marquer absent' },
  expire: { title: (c) => `Expirer ${c} ?`, text: 'Le paiement n’est pas arrivé dans le délai, le créneau est libéré.', ok: 'Marquer expirée' },
};

/* Changement de statut : seules les transitions tracées du serveur.
   Â« Confirmée Â» vient d’un encaissement (espèces : écran Factures ;
   en ligne : webhook de l’agrégateur), jamais d’un bouton. */
export default function Reservations() {
  const link = useSiteLink();
  const [items, setItems] = useState<Booking[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [events, setEvents] = useState<BookingEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const [toCancel, setToCancel] = useState<Booking | null>(null);
  const [acting, setActing] = useState<Act | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  function load() {
  setLoading(true); setError('');
    Promise.all([
      listBookings(),
      listSlots().catch(() => [] as Slot[]),
      listActivities().catch(() => [] as Activity[]),
      listBookingEvents().catch(() => [] as BookingEventItem[]),
    ])
      .then(([b, s, a, e]) => { setItems(b); setSlots(s); setActivities(a); setEvents(e); })
      .catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  const rows = useMemo(() => items.filter((b) =>
    (f === 'all' || b.status === f) &&
    (!q.trim() || b.code.toLowerCase().includes(q.trim().toLowerCase())),
  ), [items, f, q]);

  /* J : réservations saisies sans réseau, encore à synchroniser. */
  const { ops } = useSync();
  const localRows = useMemo(() => ops
    .filter((o) => o.kind === 'booking')
    .map((o) => ({
      id: Number(o.localId ?? 0),
      code: String(o.meta.code ?? '—'),
      customer: String(o.meta.customer ?? '—'),
      total: Number(o.meta.total ?? 0),
      persons: Number(o.meta.persons ?? 0),
      at: o.createdAt,
      status: o.status,
    })), [ops]);

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

  async function doAct() {
  if (!acting) return;
    setBusy(true);
    try {
      const fn = { checkin: checkInBooking, complete: completeBooking, noshow: noShowBooking, expire: expireBooking }[acting.kind];
      const b = await fn(acting.b.id);
      notify('success', ACT_TEXT[acting.kind].ok, `${b.code} — transition tracée.`);
      setActing(null);
      load();
    } catch (e) { notify('error', 'Transition impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  const resourceNoun = (b: Booking) => {
    const base = b.resource_type === 'velo' ? 'vélo' : 'quad';
    return b.quads > 1 ? `${base}s` : base;
  };
  const platesOf = (b: Booking) => (b.vehicle_plates ?? []).join(', ');

  const terminal = (s: string) => ['completed', 'cancelled', 'no_show', 'expired'].includes(s);

  /* Minuteur des sorties en cours : minuteur local du scan, sinon heure
     d'arrivée du serveur (marche depuis n'importe quel téléphone). */
  const now = useNow(items.some((b) => b.status === 'checked_in'));
  const durationOf = (b: Booking): number => {
    const slot = slots.find((s) => s.id === b.slot);
    const act = activities.find((a) => a.id === slot?.activity);
    return act?.duration_minutes && act.duration_minutes > 0 ? act.duration_minutes : 60;
  };
  const rideOf = (b: Booking): Ride | null => {
    if (b.status !== 'checked_in') return null;
    const local = getRide(b.code);
    if (local) return local;
    const evt = events
      .filter((e) => e.booking === b.id && e.action === 'status->checked_in')
      .sort((x, y) => y.id - x.id)[0];
    if (!evt) return null;
    return rideFromCheckin(b.code, b.id, evt.created_at, durationOf(b));
  };

  return (
    <AppShell>
      <PageHeader
        title="Réservations"
        sub="Â« Confirmée Â» = paiement encaissé — jamais un bouton. Le guide scanne à l’arrivée (minuteur lancé), puis au retour pour terminer."
        actions={<Link to={link("/reservations/nouvelle")} className="btn btn-accent"><Icon name="plus" size={18} />Nouvelle réservation</Link>}
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
        <EmptyState icon="ticket" title="Aucune réservation" text="Touchez Â« Nouvelle réservation Â» pour commencer."
          action={<Link to={link("/reservations/nouvelle")} className="btn btn-primary">Nouvelle réservation</Link>} />
      )}

      {localRows.length > 0 && (
        <section className="card" aria-label="Réservations saisies hors ligne">
          <div className="chart-title">
            <h3>Saisies hors ligne</h3>
            <small>{localRows.length} à synchroniser</small>
          </div>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Ces réservations ont été prises sans réseau : elles n’existent pas encore dans le Hub et ne
            sont confirmées qu’après l’envoi (le créneau peut être refusé, il faut alors arbitrer).
          </p>
          <div className="list">
            {localRows.map((l) => (
              <article className="row-card" key={`local-${l.id}`}>
                <div className="row-top">
                  <span className="stub row-title num">{l.code}</span>
                  {l.status === 'failed'
                    ? <span className="badge badge-anomaly"><Icon name="alert" size={14} />Refusée</span>
                    : <span className="badge badge-sync"><Icon name="clock" size={14} />À synchroniser</span>}
                </div>
                <div className="row-meta">
                  <span>{l.customer}</span>
                  <span className="num">{l.persons} pers.</span>
                  <span className="num">{new Date(l.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Bamako' })}</span>
                </div>
                <div className="row-top">
                  <strong className="num">{fcfa(l.total)}</strong>
                  <Link to={link('/synchronisation')} className="small">Voir la file</Link>
                </div>
              </article>
            ))}
          </div>
        </section>
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
                  <span className="num">{b.persons} pers. Â· {b.quads} {resourceNoun(b)}</span>
                  {platesOf(b) && <span className="num">{b.resource_type === 'velo' ? 'Vélos' : 'Quads'} : {platesOf(b)}</span>}
                </div>
                <div className="row-top">
                  <strong className="num">{fcfa(b.total)}</strong>
                  <span className="small muted num">Reste dû : {fcfa(Math.max(0, b.total - b.deposit_due))}</span>
                </div>
                {b.status === 'checked_in' && (() => {
                  const r = rideOf(b);
                  if (!r) return null;
                  const left = remainingMs(r, now);
                  const total = Math.max(1, r.endsAt - r.startedAt);
                  const pct = Math.max(0, Math.min(100, (left / total) * 100));
                  return (
                    <div className="ride-timer" role="timer"
                      aria-label={left <= 0 ? `Sortie ${b.code} à clôturer` : `Temps restant ${fmtCountdown(left)}`}>
                      <div className="row-top">
                        <span><Icon name="clock" size={16} /> <strong>Minuteur Â· {r.durationMin} min</strong></span>
                        <strong className="num">{left <= 0 ? 'Ã€ clôturer' : fmtCountdown(left)}</strong>
                      </div>
                      <div className="meter" role="progressbar" aria-valuenow={Math.round(100 - pct)} aria-valuemin={0} aria-valuemax={100}>
                        <span style={{ width: `${100 - pct}%` }} />
                      </div>
                      {left <= 0 && <div className="small">Durée écoulée : scannez le QR pour terminer.</div>}
                    </div>
                  );
                })()}
                <div className="btn-row">
                  {b.status === 'confirmed' && (
                    <>
                      <Link to={link(`/scanner?code=${encodeURIComponent(b.code)}`)} className="btn btn-sm btn-accent">
                        <Icon name="scan" size={16} />Scanner
                      </Link>
                      <button type="button" className="btn btn-sm" onClick={() => setActing({ kind: 'checkin', b })}>Arrivée</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setActing({ kind: 'noshow', b })}>Absent</button>
                    </>
                  )}
                  {b.status === 'checked_in' && (
                    <>
                      <Link to={link(`/scanner?code=${encodeURIComponent(b.code)}`)} className="btn btn-sm btn-accent">
                        <Icon name="scan" size={16} />Scanner
                      </Link>
                      <button type="button" className="btn btn-sm" onClick={() => setActing({ kind: 'complete', b })}>Terminée</button>
                    </>
                  )}
                  {b.status === 'pending_deposit' && (
                    <>
                      <Link to={link("/factures")} className="btn btn-sm btn-accent">Encaisser</Link>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setActing({ kind: 'expire', b })}>Expirer</button>
                    </>
                  )}
                  {!terminal(b.status) && (
                    <IconButton icon="x" label={`Annuler ${b.code}`} className="danger plain" onClick={() => setToCancel(b)} />
                  )}
                  <Link to={link(`/documents/${b.id}/facture`)} className="icon-btn plain" aria-label={`Facture de ${b.code}`} title={`Facture de ${b.code}`}>
                    <Icon name="file" size={20} />
                  </Link>
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
                    <td className="num">{b.persons} Â· {b.quads} {resourceNoun(b)}</td>
                    <td className="num">{fcfa(b.total)}</td>
                    <td className="num">{fcfa(Math.max(0, b.total - b.deposit_due))}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>
                      {b.status === 'confirmed' && (
                        <>
                          <Link to={link(`/scanner?code=${encodeURIComponent(b.code)}`)} className="icon-btn plain" aria-label={`Scanner ${b.code} (arrivée)`} title={`Scanner ${b.code} (arrivée)`}>
                            <Icon name="scan" size={20} />
                          </Link>
                          <IconButton icon="check" label={`Arrivée de ${b.code}`} className="plain" onClick={() => setActing({ kind: 'checkin', b })} />
                        </>
                      )}
                      {b.status === 'checked_in' && (
                        <>
                          {(() => {
                            const r = rideOf(b);
                            if (!r) return null;
                            const left = remainingMs(r, now);
                            return (
                              <span className="badge badge-confirmed num" role="timer" title={`Formule ${r.durationMin} min`}>
                                <Icon name="clock" size={14} />{left <= 0 ? 'Ã€ clôturer' : fmtCountdown(left)}
                              </span>
                            );
                          })()}
                          <Link to={link(`/scanner?code=${encodeURIComponent(b.code)}`)} className="icon-btn plain" aria-label={`Scanner ${b.code} (fin de sortie)`} title={`Scanner ${b.code} (fin de sortie)`}>
                            <Icon name="scan" size={20} />
                          </Link>
                          <IconButton icon="check" label={`Terminer ${b.code}`} className="plain" onClick={() => setActing({ kind: 'complete', b })} />
                        </>
                      )}
                      {!terminal(b.status) && <IconButton icon="x" label={`Annuler ${b.code}`} className="danger plain" onClick={() => setToCancel(b)} />}
                      <Link to={link(`/documents/${b.id}/facture`)} className="icon-btn plain" aria-label={`Facture de ${b.code}`} title={`Facture de ${b.code}`}>
                        <Icon name="file" size={20} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {acting && (
        <ConfirmDialog
          title={ACT_TEXT[acting.kind].title(acting.b.code)}
          text={`${ACT_TEXT[acting.kind].text} Transition tracée (qui, quand, avant, après).`}
          confirmLabel={ACT_TEXT[acting.kind].ok} busy={busy}
          onConfirm={doAct} onClose={() => !busy && setActing(null)}
        />
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
