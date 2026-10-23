import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import { PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import {
  getClosingDay, listAnomalies, listBookings, listCalls, listPayments, todayISO,
  type Anomaly, type Booking, type CallItem, type ClosingDay, type Payment,
} from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';

export default function Closing() {
  const link = useSiteLink();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [open, setOpen] = useState<Anomaly[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [day, setDay] = useState<ClosingDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const today = todayISO();

  useEffect(() => {
    Promise.all([
      listBookings().catch(() => [] as Booking[]),
      listCalls().catch(() => [] as CallItem[]),
      listAnomalies().catch(() => [] as Anomaly[]),
      listPayments().catch(() => [] as Payment[]),
      getClosingDay(today).catch(() => null),
    ])
      .then(([b, c, a, p, d]) => { setBookings(b); setCalls(c); setOpen(a.filter((x) => x.status === 'open')); setPayments(p); setDay(d); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [today]);

  const todayBookings = useMemo(() => bookings.filter((b) => new Date(b.expires_at).toISOString().slice(0, 10) === today), [bookings, today]);
  const paidOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of payments.filter((x) => x.status === 'paid')) m.set(p.booking, (m.get(p.booking) ?? 0) + p.amount);
    return m;
  }, [payments]);
  const encaissé = useMemo(() => todayBookings.reduce((s, b) => s + (paidOf.get(b.id) ?? 0), 0), [todayBookings, paidOf]);
  const pending = useMemo(() => todayBookings
    .filter((b) => b.status === 'pending_deposit')
    .reduce((s, b) => s + Math.max(0, b.total - (paidOf.get(b.id) ?? 0)), 0), [todayBookings, paidOf]);
  const todayCalls = useMemo(() => calls.filter((c) => new Date(c.started_at).toISOString().slice(0, 10) === today), [calls, today]);

  const bordereau = day?.closing ?? null;
  const cloturee = Boolean(day?.closed && bordereau);
  const heure = `${String(day?.closing_hour ?? 20).padStart(2, '0')}:00`;
  const validéeLe = bordereau?.validated_at
    ? new Date(bordereau.validated_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <AppShell anomalies={open.length}>
      <PageHeader
        title="Clôture du jour"
        sub={`${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} — clôture réseau automatique à ${heure} (heure du Mali), consultative.`}
      />

      {loading && <SkeletonList n={3} />}
      {error && <div className="alert-error" role="alert"><Icon name="alert" size={18} />{error}</div>}

      {!loading && !error && (
        <>
          {cloturee && bordereau ? (
            <section className="card">
              <div className="chart-title"><h3>Journée clôturée</h3><small>{bordereau.date}</small></div>
              <div className="stack" style={{ marginTop: 8 }}>
                <div className="row-top">
                  <div><div className="row-title">Réservations du jour</div></div>
                  <div className="num">{bordereau.bookings_count}</div>
                </div>
                <div className="row-top">
                  <div><div className="row-title">Encaissé</div></div>
                  <div className="num">{fcfa(bordereau.amount_collected)}</div>
                </div>
                <div className="row-top">
                  <div><div className="row-title">Appels</div></div>
                  <div className="num">{bordereau.calls_count}</div>
                </div>
                <div className="row-top">
                  <div><div className="row-title">Anomalies ouvertes</div></div>
                  <div className="num">{bordereau.anomalies_open}</div>
                </div>
              </div>
              <p className="small muted" style={{ marginTop: 12 }}>
                Clôturée automatiquement le {validéeLe} — le bordereau réseau est verrouillé.
                Pour toute correction ultérieure, passez par un justificatif (motif tracé).
              </p>
            </section>
          ) : (
            <>
              <div className="kpi-grid">
                <div className="kpi featured">
                  <span className="kpi-top"><Icon name="ticket" size={16} />Réservations du jour</span>
                  <span className="kpi-value num">{todayBookings.length}</span>
                  <span className="kpi-sub">{bookings.length} au total sur la période</span>
                </div>
                <div className="kpi">
                  <span className="kpi-top"><Icon name="wallet" size={16} />Encaissé aujourd'hui</span>
                  <span className="kpi-value num">{fcfa(encaissé)}</span>
                  <span className="kpi-sub">Paiements reçus</span>
                </div>
                <div className="kpi">
                  <span className="kpi-top"><Icon name="clock" size={16} />Reste à encaisser</span>
                  <span className="kpi-value num">{fcfa(pending)}</span>
                  <span className="kpi-sub">En attente de paiement</span>
                </div>
                <div className="kpi">
                  <span className="kpi-top"><Icon name="phone" size={16} />Appels du jour</span>
                  <span className="kpi-value num">{todayCalls.length}</span>
                  <span className="kpi-sub">{open.length} anomalie{open.length > 1 ? 's' : ''} à justifier</span>
                </div>
              </div>

              {todayBookings.length > 0 && (
                <section className="card">
                  <div className="chart-title"><h3>Réservations du jour</h3><Link to={link('/reservations')} className="small">Tout voir</Link></div>
                  <div className="stack" style={{ marginTop: 8 }}>
                    {todayBookings.slice(0, 6).map((b) => (
                      <div key={b.id} className="row-top">
                        <div>
                          <div className="row-title num">{fmtSlot(b.expires_at)} · {b.code}</div>
                          <div className="row-meta"><span className="num">{fcfa(b.total)}</span><span className="num">{b.persons} pers.</span></div>
                        </div>
                        <span className="num">{fcfa(paidOf.get(b.id) ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <section className="card">
            <div className="chart-title"><h3>{cloturee ? 'Bordereau réseau' : 'Clôture automatique réseau'}</h3></div>
            <p className="small muted" style={{ marginBottom: 10 }}>
              {cloturee
                ? `Journée clôturée à ${heure} par le système. Ce bordereau réseau n'est plus modifiable : il reste consultatif.`
                : `La journée sera clôturée automatiquement à ${heure} (heure du Mali) : aucun bouton à utiliser, le bordereau réseau est généré et verrouillé par le système.`}
              {!cloturee && open.length > 0 &&
                ` ${open.length} anomalie${open.length > 1 ? 's' : ''} d'appel encore ouverte${open.length > 1 ? 's' : ''} : justifiez-la${open.length > 1 ? 's' : ''} avant ${heure} (motif tracé).`}
            </p>
          </section>
        </>
      )}
    </AppShell>
  );
}
