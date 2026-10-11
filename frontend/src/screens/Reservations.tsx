import { useEffect, useState } from 'react';
import StatusBadge from '../components/StatusBadge';
import { listBookings, type Booking } from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';

export default function Reservations() {
  const [items, setItems] = useState<Booking[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listBookings().then(setItems).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="main">
      {error && <div className="alert-error" role="alert">{error}</div>}
      {items.length === 0 && !error && (
        <div className="card"><p>Aucune réservation. Touchez « Nouvelle réservation » pour commencer.</p></div>
      )}
      {items.map((b) => (
        <article className="card" key={b.id}>
          <div className="num">{fmtSlot(b.expires_at)} — {b.code}</div>
          <div><StatusBadge status={b.status} /></div>
          <div className="num">Reste dû : {fcfa(b.total - b.deposit_due)}</div>
        </article>
      ))}
    </div>
  );
}
