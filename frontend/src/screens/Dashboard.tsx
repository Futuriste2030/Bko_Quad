import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { AreaChart, BarChart, Donut } from '../components/charts';
import { EmptyState, PageHeader, SkeletonList } from '../components/ui';
import { ROLE_LABELS, useAuth } from '../lib/auth';
import Icon from '../lib/icons';
import { listAnomalies, listBookings, listCalls, listNotices, listPayments, type Anomaly, type Booking, type CallItem, type Payment } from '../lib/api';
import { fcfa, fmtPhone, fmtSlot } from '../lib/format';

const FULL_ROLES = ['admin', 'superadmin', 'comptable'];

export default function Dashboard() {
  const link = useSiteLink();
  const { user, role } = useAuth();
  const full = role != null && FULL_ROLES.includes(role);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [notice, setNotice] = useState<{ id: number; title: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([listBookings(), listCalls().catch(() => [] as CallItem[]), listAnomalies().catch(() => [] as Anomaly[]), listPayments().catch(() => [] as Payment[])])
      .then(([b, c, a, p]) => { setBookings(b); setCalls(c); setAnomalies(a); setPayments(p.filter((x) => x.status === 'paid')); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    listNotices().then((ns) => {
      const pub = ns.filter((n) => n.type === 'communique' && n.status === 'published');
      if (pub.length > 0) setNotice({ id: pub[0].id, title: pub[0].title });
    }).catch(() => undefined);
  }, []);

  const openAnom = useMemo(() => anomalies.filter((a) => a.status === 'open'), [anomalies]);
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const roleLabel = role && ROLE_LABELS[role] ? ROLE_LABELS[role] : '—';
  const todayB = useMemo(
    () => bookings.filter((b) => new Date(b.expires_at).toLocaleDateString('fr-FR') === new Date().toLocaleDateString('fr-FR')),
    [bookings],
  );
  const upNext = useMemo(() => {
    const now = Date.now();
    return bookings
      .filter((b) => new Date(b.expires_at).getTime() >= now && ['pending_deposit', 'confirmed', 'checked_in'].includes(b.status))
      .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime());
  }, [bookings]);
  const revenue = useMemo(() => bookings.filter((b) => b.status === 'confirmed' || b.status === 'completed').reduce((s, b) => s + b.total, 0), [bookings]);
  const paidOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of payments) m.set(p.booking, (m.get(p.booking) ?? 0) + p.amount);
    return m;
  }, [payments]);
  const pending = useMemo(() => bookings
    .filter((b) => b.status === 'pending_deposit')
    .reduce((s, b) => s + Math.max(0, b.total - (paidOf.get(b.id) ?? 0)), 0), [bookings, paidOf]);

  const last7 = useMemo(() => {
    const days: { label: string; value: number; hot?: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      const fullDay = d.toLocaleDateString('fr-FR');
      const n = bookings.filter((b) => new Date(b.expires_at).toLocaleDateString('fr-FR') === fullDay).length;
      days.push({ label: key, value: n, hot: i === 0 });
    }
    return days;
  }, [bookings]);

  const cumul = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const d of last7) { acc += d.value; arr.push(acc); }
    return arr;
  }, [last7]);

  /* Tracé animé du cumulé (désactivé si l'usager réduit les animations). */
  const [draw, setDraw] = useState(1);
  useEffect(() => {
    if (!full) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setDraw(1); return; }
    setDraw(0);
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setDraw(p);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [bookings.length, full]);

  const byStatus = useMemo(() => {
    const colors: Record<string, string> = {
      pending_deposit: '#f2b01e', confirmed: '#17703d', checked_in: '#1d5fd1',
      completed: '#5c5c5c', cancelled: '#c62828', no_show: '#c62828', expired: '#b5b0a6',
    };
    const labels: Record<string, string> = {
      pending_deposit: 'En attente', confirmed: 'Confirmées', checked_in: 'Arrivées',
      completed: 'Terminées', cancelled: 'Annulées', no_show: 'Absents', expired: 'Expirées',
    };
    const m = new Map<string, number>();
    for (const b of bookings) m.set(b.status, (m.get(b.status) ?? 0) + 1);
    return [...m.entries()].map(([k, v]) => ({ label: labels[k] ?? k, value: v, color: colors[k] ?? '#888' }));
  }, [bookings]);

  return (
    <AppShell anomalies={openAnom.length}>
      <PageHeader
        title={`Bonjour ${user?.username ?? ''}`}
        sub={full
          ? `Pilotage de l’agence — ${today} · ${roleLabel} · Une seule source de vérité : le Hub.`
          : `${roleLabel} — ${today}`}
        actions={<Link to={link("/reservations/nouvelle")} className="btn btn-accent"><Icon name="plus" size={18} />Nouvelle réservation</Link>}
      />

      {notice && (
        <div className="banner" role="note">
          <Icon name="send" size={20} />
          <div>
            <strong>Communiqué : {notice.title}</strong>
            <div className="small"><Link to={link("/communication")}>Lire le communiqué</Link></div>
          </div>
        </div>
      )}

      {openAnom.length > 0 && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <strong>{openAnom.length} anomalie{openAnom.length > 1 ? 's' : ''} à justifier</strong>
            <div className="small">Appels non rapprochés — motif obligatoire. <Link to={link("/appels")}>Traiter les appels</Link></div>
          </div>
        </div>
      )}

      {loading && <SkeletonList n={4} />}
      {error && !loading && (
        <div className="alert-error" role="alert"><Icon name="alert" size={18} />{error}</div>
      )}

      {!loading && !error && full && (
        <>
          <div className="kpi-grid">
            <div className="kpi featured">
              <span className="kpi-top"><Icon name="ticket" size={16} />Réservations du jour</span>
              <span className="kpi-value num">{todayB.length}</span>
              <span className="kpi-sub">{bookings.length} au total sur la période</span>
            </div>
            <div className="kpi">
              <span className="kpi-top"><Icon name="wallet" size={16} />Chiffre confirmé</span>
              <span className="kpi-value num">{fcfa(revenue)}</span>
              <span className="kpi-sub">Confirmées + terminées</span>
            </div>
            <div className="kpi">
              <span className="kpi-top"><Icon name="clock" size={16} />Reste à encaisser</span>
              <span className="kpi-value num">{fcfa(pending)}</span>
              <span className="kpi-sub">En attente de paiement</span>
            </div>
            <div className="kpi">
              <span className="kpi-top"><Icon name="phone" size={16} />Appels / anomalies</span>
              <span className="kpi-value num">{calls.length} / {openAnom.length}</span>
              <span className="kpi-sub">100 % rapprochés ou justifiés</span>
            </div>
          </div>

          <div className="grid-2">
            <section className="card chart-card">
              <div className="chart-title"><h3>Réservations — 7 derniers jours</h3><small className="num">Total {last7.reduce((s, d) => s + d.value, 0)}</small></div>
              <BarChart data={last7} />
              <div className="chart-legend"><span><i className="accent" />Aujourd’hui</span><span><i />Jours passés</span></div>
            </section>
            <section className="card chart-card">
              <div className="chart-title"><h3>Répartition par statut</h3><small>7 statuts persistés</small></div>
              {byStatus.length > 0 ? <Donut slices={byStatus} /> : <p>Aucune donnée pour le moment.</p>}
            </section>
          </div>

          <div className="grid-2">
            <section className="card chart-card">
              <div className="chart-title"><h3>Montée en charge cumulée</h3><small className="num">Total 7 j : {cumul[cumul.length - 1] ?? 0}</small></div>
              <AreaChart data={cumul} progress={draw} />
              <div className="chart-legend">
                <span><i className="accent" />Point orange : total à ce jour</span>
              </div>
              <p className="small muted">Comment lire : chaque point ajoute les réservations du jour aux précédentes — le dernier point est le total des 7 derniers jours.</p>
            </section>
            <section className="card">
              <div className="chart-title"><h3>Planning du jour</h3><Link to={link("/calendrier")} className="small">Voir le calendrier</Link></div>
              <div className="stack" style={{ marginTop: 8 }}>
                {todayB.slice(0, 4).map((b) => (
                  <div key={b.id} className="row-top">
                    <div>
                      <div className="row-title num">{b.code}</div>
                      <div className="row-meta"><span className="num">{fmtSlot(b.expires_at)}</span><span className="num">{b.persons} pers.</span></div>
                    </div>
                    <StatusBadge status={b.status} />
                  </div>
                ))}
                {todayB.length === 0 && <p>Aucune réservation aujourd’hui. Créez la première depuis le bouton ci-dessus.</p>}
              </div>
            </section>
          </div>

          <section className="card">
            <div className="chart-title"><h3>Derniers appels à rapprocher</h3><Link to={link("/appels")} className="small">Tout traiter</Link></div>
            <div className="list" style={{ marginTop: 8 }}>
              {calls.slice(0, 3).map((c) => (
                <div key={c.id} className="row-top">
                  <div>
                    <div className="row-title num">{fmtPhone(c.phone_number)}</div>
                    <div className="row-meta"><span className="num">{fmtSlot(c.started_at)}</span><span className="num">{c.duration_seconds} s</span></div>
                  </div>
                  <Link to={link(`/reservations/nouvelle?phone=${encodeURIComponent(c.phone_number)}`)} className="btn btn-sm btn-ghost">Réserver</Link>
                </div>
              ))}
              {calls.length === 0 && <EmptyState icon="phone" title="Aucun appel en attente" text="Le journal se remplit à chaque appel entrant." />}
            </div>
          </section>
        </>
      )}

      {!loading && !error && !full && (
        <>
          <div className="kpi-grid">
            <div className="kpi featured">
              <span className="kpi-top"><Icon name="ticket" size={16} />Réservations du jour</span>
              <span className="kpi-value num">{todayB.length}</span>
              <span className="kpi-sub">{bookings.length} au total sur la période</span>
            </div>
            <div className="kpi">
              <span className="kpi-top"><Icon name="clock" size={16} />Départs à venir</span>
              <span className="kpi-value num">{upNext.length}</span>
              <span className="kpi-sub">Prochain : {upNext[0] ? fmtSlot(upNext[0].expires_at) : '—'}</span>
            </div>
            <div className="kpi">
              <span className="kpi-top"><Icon name="phone" size={16} />Appels à rapprocher</span>
              <span className="kpi-value num">{calls.length}</span>
              <Link to={link("/appels")} className="kpi-sub">Traiter maintenant</Link>
            </div>
            <div className="kpi">
              <span className="kpi-top"><Icon name="wallet" size={16} />Reste à encaisser</span>
              <span className="kpi-value num">{fcfa(pending)}</span>
              <span className="kpi-sub">En attente de paiement</span>
            </div>
          </div>

          <section className="card">
            <div className="chart-title"><h3>Départs à venir</h3><Link to={link("/calendrier")} className="small">Voir le calendrier</Link></div>
            <div className="stack" style={{ marginTop: 8 }}>
              {upNext.slice(0, 5).map((b) => (
                <div key={b.id} className="row-top">
                  <div>
                    <div className="row-title num">{fmtSlot(b.expires_at)} · {b.code}</div>
                    <div className="row-meta"><span className="num">{b.persons} pers.</span></div>
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              ))}
              {upNext.length === 0 && <p>Aucun départ à venir sur votre site.</p>}
            </div>
          </section>

          <section className="card">
            <div className="chart-title"><h3>Derniers appels à rapprocher</h3><Link to={link("/appels")} className="small">Tout traiter</Link></div>
            <div className="list" style={{ marginTop: 8 }}>
              {calls.slice(0, 3).map((c) => (
                <div key={c.id} className="row-top">
                  <div>
                    <div className="row-title num">{fmtPhone(c.phone_number)}</div>
                    <div className="row-meta"><span className="num">{fmtSlot(c.started_at)}</span><span className="num">{c.duration_seconds} s</span></div>
                  </div>
                  <Link to={link(`/reservations/nouvelle?phone=${encodeURIComponent(c.phone_number)}`)} className="btn btn-sm btn-ghost">Réserver</Link>
                </div>
              ))}
              {calls.length === 0 && <EmptyState icon="phone" title="Aucun appel en attente" text="Le journal se remplit à chaque appel entrant." />}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
