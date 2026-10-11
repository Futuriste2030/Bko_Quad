import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAnomalies, listCalls, reconcileCall, resolveAnomaly, type CallItem } from '../lib/api';
import { fmtPhone, fmtSlot } from '../lib/format';

const REASONS = [
  { v: 'renseignement', label: 'Renseignement' },
  { v: 'annulation', label: 'Annulation' },
  { v: 'faux_numero', label: 'Faux numéro' },
  { v: 'autre', label: 'Autre' },
];

export default function Calls() {
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [anomByCall, setAnomByCall] = useState<Record<number, number>>({});
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [reason, setReason] = useState('renseignement');

  useEffect(() => {
    Promise.all([listCalls(), listAnomalies()])
      .then(([c, a]) => {
        setCalls(c);
        const m: Record<number, number> = {};
        for (const an of a) if (an.status === 'open') m[an.call] = an.id;
        setAnomByCall(m);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function reconcile(id: number) {
    setError(''); setInfo('');
    try {
      const r = await reconcileCall(id);
      if (r.booking) setInfo(`Appel rapproché : réservation ${r.booking.code}.`);
      else {
        if (r.anomaly) setAnomByCall((m) => ({ ...m, [id]: r.anomaly!.id }));
        setInfo('Aucune réservation trouvée : anomalie créée, motif requis.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rapprochement impossible.');
    }
  }

  async function resolve(callId: number) {
    setError(''); setInfo('');
    const anomalyId = anomByCall[callId];
    if (!anomalyId) { setError('Rapprochez d’abord l’appel pour créer l’anomalie.'); return; }
    try {
      await resolveAnomaly(anomalyId, reason);
      setAnomByCall((m) => { const n = { ...m }; delete n[callId]; return n; });
      setInfo('Anomalie justifiée.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clôture impossible.');
    }
  }

  return (
    <div className="main">
      {error && <div className="alert-error" role="alert">{error}</div>}
      {info && <div className="card" role="status">{info}</div>}
      {calls.map((c) => (
        <article className="card" key={c.id}>
          <div className="num">{fmtPhone(c.phone_number)}</div>
          <div className="num">{fmtSlot(c.started_at)} — {c.duration_seconds}s</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => reconcile(c.id)}>Rapprocher</button>
            <Link to={`/reservations/nouvelle?phone=${encodeURIComponent(c.phone_number)}`}>
              <button className="btn btn-accent">Nouvelle réservation</button>
            </Link>
            <div className="field">
              <label htmlFor={`reason-${c.id}`}>Motif (obligatoire pour clore)</label>
              <select id={`reason-${c.id}`} value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </div>
            <button className="btn" onClick={() => resolve(c.id)}>Justifier l’appel</button>
          </div>
        </article>
      ))}
      {calls.length === 0 && !error && <div className="card"><p>Aucun appel à traiter.</p></div>}
    </div>
  );
}
