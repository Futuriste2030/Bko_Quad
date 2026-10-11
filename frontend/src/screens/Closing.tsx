import { useEffect, useState } from 'react';
import { listAnomalies, todayISO, validateClosing, type Anomaly, type Closing } from '../lib/api';
import { fcfa } from '../lib/format';

export default function Closing() {
  const [closing, setClosing] = useState<Closing | null>(null);
  const [open, setOpen] = useState<Anomaly[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listAnomalies().then((a) => setOpen(a.filter((x) => x.status === 'open')))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function submit() {
    setError('');
    try {
      setClosing(await validateClosing(todayISO()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clôture impossible.');
    }
  }

  return (
    <div className="main">
      {error && <div className="alert-error" role="alert">{error}</div>}
      <section className="card">
        <h2>Clôture du jour</h2>
        <p>Anomalies ouvertes : <strong className="num">{open.length}</strong></p>
        {closing && (
          <div className="num">
            Réservations : {closing.bookings_count} — Encaissé : {fcfa(closing.amount_collected)} —
            Appels : {closing.calls_count} — Anomalies : {closing.anomalies_open}
          </div>
        )}
        <button className="btn btn-primary" onClick={submit}>Valider la journée</button>
      </section>
    </div>
  );
}
