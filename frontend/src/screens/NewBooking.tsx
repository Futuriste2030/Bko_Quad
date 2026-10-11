import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import {
  clearDraft, createBooking, createCustomer, createPayLink,
  listBookings, listCustomers, listSlots, loadDraft, logMessage, saveDraft,
  type Booking, type Customer, type Slot,
} from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';

const ACTIVE = ['pending_deposit', 'confirmed', 'checked_in'];

export default function NewBooking() {
  const [params] = useSearchParams();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState(params.get('phone') ?? '');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [slotId, setSlotId] = useState<number | null>(() => {
    const s = params.get('slot');
    return s ? Number(s) : null;
  });
  const [persons, setPersons] = useState('2');
  const [quads, setQuads] = useState('1');
  const [source, setSource] = useState('phone');
  const [done, setDone] = useState<Booking | null>(null);
  const [payRef, setPayRef] = useState('');
  const [waMe, setWaMe] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([listCustomers(), listSlots(), listBookings()])
      .then(([c, s, b]) => { setCustomers(c); setSlots(s); setBookings(b); })
      .catch((e: Error) => setError(e.message));
    const d = loadDraft();
    if (d) setPhone(d);
  }, []);

  const used = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of bookings) {
      if (!ACTIVE.includes(b.status)) continue;
      m.set(b.slot, (m.get(b.slot) ?? 0) + b.persons);
    }
    return m;
  }, [bookings]);

  function pickCustomer() {
    setError('');
    const found = customers.find((c) => c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    if (found) { setCustomer(found); setStep(2); return; }
    if (!name.trim()) { setError('Client inconnu : saisissez son nom pour le créer.'); return; }
    createCustomer({ name: name.trim(), phone: phone.trim() })
      .then((c) => { setCustomer(c); setStep(2); })
      .catch((e: Error) => setError(e.message));
  }

  async function submit() {
    setError('');
    if (!customer || !slotId) { setError('Client et créneau requis.'); return; }
    try {
      const b = await createBooking({
        customer: customer.id, slot: slotId,
        persons: Number(persons), quads: Number(quads), source,
      });
      setDone(b);
      clearDraft();
      try {
        const link = await createPayLink(b.id);
        setPayRef(link.reference);
        const text = `Bonjour, votre réservation ${b.code} est en attente d’acompte (${fcfa(b.deposit_due)}).`;
        const logged = await logMessage(b.id, text);
        setWaMe(logged.wa_me);
      } catch {
        // Lien/paiement indisponible : la réservation reste valide en attente.
      }
      setStep(4);
    } catch (e) {
      saveDraft(phone);
      setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
    }
  }

  return (
    <div className="main">
      {error && <div className="alert-error" role="alert">{error}</div>}
      {step === 1 && (
        <section className="card">
          <h2>1. Client</h2>
          <div className="field">
            <label htmlFor="phone">Téléphone (obligatoire)</label>
            <input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+223…" />
          </div>
          <div className="field">
            <label htmlFor="name">Nom (si nouveau client)</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du client" />
          </div>
          <button className="btn btn-primary" onClick={pickCustomer}>Continuer</button>
        </section>
      )}
      {step === 2 && (
        <section className="card">
          <h2>2. Créneau</h2>
          {slots.map((s) => {
            const left = s.capacity - (used.get(s.id) ?? 0);
            const full = s.closed || left <= 0;
            return (
              <label key={s.id} style={{ display: 'flex', gap: 8, minHeight: 48, alignItems: 'center' }}>
                <input type="radio" name="slot" disabled={full} checked={slotId === s.id} onChange={() => setSlotId(s.id)} />
                <span className="num">{fmtSlot(s.start)} — {full ? 'complet' : `${left} places`}</span>
              </label>
            );
          })}
          <button className="btn btn-primary" onClick={() => slotId && setStep(3)}>Continuer</button>
        </section>
      )}
      {step === 3 && (
        <section className="card">
          <h2>3. Détails et prix</h2>
          <div className="field">
            <label htmlFor="persons">Personnes (obligatoire)</label>
            <input id="persons" inputMode="numeric" value={persons} onChange={(e) => setPersons(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="quads">Quads (obligatoire)</label>
            <input id="quads" inputMode="numeric" value={quads} onChange={(e) => setQuads(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="source">Source (obligatoire)</label>
            <select id="source" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="phone">Téléphone</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="onsite">Sur place</option>
              <option value="online">En ligne</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={submit}>Enregistrer la réservation</button>
        </section>
      )}
      {step === 4 && done && (
        <section className="card">
          <h2>4. Récapitulatif</h2>
          <div className="num">{done.code}</div>
          <div><StatusBadge status={done.status} /></div>
          <div className="num">Total : {fcfa(done.total)} — Acompte : {fcfa(done.deposit_due)}</div>
          {payRef && <div className="num">Lien de paiement : {payRef}</div>}
          {waMe && <a href={waMe} target="_blank" rel="noreferrer"><button className="btn btn-accent">Envoyer par WhatsApp</button></a>}
        </section>
      )}
    </div>
  );
}
