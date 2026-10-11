import { useState } from 'react';
import { createBooking } from '../lib/api';

export default function NewBooking() {
  const [customer, setCustomer] = useState('');
  const [slot, setSlot] = useState('');
  const [persons, setPersons] = useState('2');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function submit() {
    setError(''); setOk('');
    try {
      const b = await createBooking({
        customer: Number(customer), slot: Number(slot), persons: Number(persons), source: 'phone',
      });
      setOk(`Réservation ${b.code} enregistrée, en attente d’acompte.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
    }
  }

  return (
    <div className="main">
      {error && <div className="alert-error" role="alert">{error}</div>}
      {ok && <div className="card" role="status">{ok}</div>}
      <div className="field">
        <label htmlFor="customer">Client (obligatoire)</label>
        <input id="customer" inputMode="numeric" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="N° client" />
      </div>
      <div className="field">
        <label htmlFor="slot">Créneau (obligatoire)</label>
        <input id="slot" inputMode="numeric" value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="N° créneau" />
      </div>
      <div className="field">
        <label htmlFor="persons">Personnes (obligatoire)</label>
        <input id="persons" inputMode="numeric" value={persons} onChange={(e) => setPersons(e.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={submit}>Enregistrer la réservation</button>
    </div>
  );
}
