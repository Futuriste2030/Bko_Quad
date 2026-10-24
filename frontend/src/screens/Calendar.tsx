import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import { EmptyState, PageHeader, SkeletonList } from '../components/ui';
import { listBookings, listSlots, type Booking, type Slot } from '../lib/api';
import { fcfa } from '../lib/format';

export default function Calendar() {
  const link = useSiteLink();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([listSlots(), listBookings()])
      .then(([s, b]) => { setSlots(s); setBookings(b); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const days = useMemo(() => {
    const m = new Map<string, { date: Date; slots: Slot[] }>();
    for (const s of slots) {
  const d = new Date(s.start);
      const key = d.toLocaleDateString('fr-FR');
      if (!m.has(key)) m.set(key, { date: d, slots: [] });
      m.get(key)!.slots.push(s);
    }
    return [...m.entries()].sort((a, b) => a[1].date.getTime() - b[1].date.getTime()).slice(0, 14);
  }, [slots]);

  const loadOf = (id: number) => bookings.filter((b) => b.slot === id && ['pending_deposit', 'confirmed', 'checked_in'].includes(b.status))
    .reduce((s, b) => s + b.persons, 0);

  return (
    <AppShell>
      <PageHeader title="Calendrier" sub="Créneaux et remplissage, 14 prochains jours. Les heures sont affichées à Bamako." />
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && days.length === 0 && (
        <EmptyState icon="calendar" title="Aucun créneau publié" text="Les créneaux configurés apparaîtront ici." />
      )}
      {!loading && !error && days.map(([key, g]) => (
        <section className="card" key={key}>
          <h2 className="num">{g.date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}</h2>
          <div className="list" style={{ marginTop: 8 }}>
            {g.slots.map((s) => {
              const used = loadOf(s.id);
              const left = s.capacity - used;
              const pct = Math.min(100, Math.round((used / Math.max(1, s.capacity)) * 100));
              const t = new Date(s.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={s.id} className="row-top">
                  <div>
                    <div className="row-title num">{t} — {s.capacity} places</div>
                    <div className="row-meta"><span className="num">{used} inscrits · {left} restantes</span></div>
                    <div style={{ height: 6, borderRadius: 4, background: 'var(--surface-2)', marginTop: 6, minWidth: 160 }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: left <= 0 ? 'var(--danger)' : 'var(--ink)' }} />
                    </div>
                  </div>
                  <Link to={link(`/reservations/nouvelle?slot=${s.id}`)} className="btn btn-sm btn-ghost">Réserver</Link>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p className="small muted num">Montants entiers en FCFA, sans décimales. Ex. {fcfa(50000)}.</p>
    </AppShell>
  );
}
