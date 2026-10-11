import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBookings, listSlots, type Booking, type Slot } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';

const ACTIVE = ['pending_deposit', 'confirmed', 'checked_in'];

export default function Calendar() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([listSlots(), listBookings()])
      .then(([s, b]) => { setSlots(s); setBookings(b); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const used = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of bookings) {
      if (!ACTIVE.includes(b.status)) continue;
      m.set(b.slot, (m.get(b.slot) ?? 0) + b.persons);
    }
    return m;
  }, [bookings]);

  return (
    <div className="main">
      {error && <div className="alert-error" role="alert">{error}</div>}
      {slots.map((s) => {
        const left = s.capacity - (used.get(s.id) ?? 0);
        const full = s.closed || left <= 0;
        return (
          <article className="card" key={s.id}>
            <div className="num">{fmtSlot(s.start)}</div>
            <div>Places restantes : <strong className="num">{Math.max(0, left)}</strong></div>
            {full ? (
              <p>Ce créneau est complet, choisissez-en un autre.</p>
            ) : (
              <Link to={`/reservations/nouvelle?slot=${s.id}`}><button className="btn btn-primary">Choisir le créneau</button></Link>
            )}
          </article>
        );
      })}
      {slots.length === 0 && !error && <div className="card"><p>Aucun créneau publié pour le moment.</p></div>}
      <p className="num">Montants en {fcfa(0).replace('0', '').trim() || 'FCFA'} — prix calculés à l’étape suivante.</p>
    </div>
  );
}
