import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { Field, PageHeader } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import {
  clearDraft, createBooking, createCustomer, createPayLink,
  listBookings, listCustomers, listSlots, loadDraft, logMessage, saveDraft,
  type Booking, type Customer, type Slot,
} from '../lib/api';
import { fcfa, fmtSlot } from '../lib/format';

const ACTIVE = ['pending_deposit', 'confirmed', 'checked_in'];
const STEPS = ['Client', 'Créneau', 'Détails', 'Récapitulatif'];

export default function NewBooking() {
  const [params] = useSearchParams();
  const { notify } = useToast();
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listCustomers(), listSlots(), listBookings()])
      .then(([c, s, b]) => { setCustomers(c); setSlots(s); setBookings(b); })
      .catch((e: Error) => setError(e.message));
    const d = loadDraft();
    if (d && !params.get('phone')) setPhone(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (found) { setCustomer(found); setStep(2); notify('info', 'Client retrouvé', found.name); return; }
    if (!name.trim()) { setError('Client inconnu : saisissez son nom pour le créer.'); return; }
    setBusy(true);
    createCustomer({ name: name.trim(), phone: phone.trim() })
      .then((c) => { setCustomer(c); setStep(2); notify('success', 'Client enregistré', c.name); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }

  async function submit() {
    setError('');
    if (!customer || !slotId) { setError('Client et créneau requis.'); return; }
    setBusy(true);
    try {
      const b = await createBooking({
        customer: customer.id, slot: slotId,
        persons: Number(persons), quads: Number(quads), source,
      });
      setDone(b);
      clearDraft();
      notify('success', 'Réservation enregistrée', `${b.code} — en attente d’acompte.`);
      try {
        const link = await createPayLink(b.id);
        setPayRef(link.reference);
        const text = `Bonjour, votre réservation ${b.code} est en attente d’acompte (${fcfa(b.deposit_due)}).`;
        const logged = await logMessage(b.id, text);
        setWaMe(logged.wa_me);
      } catch {
        notify('warning', 'Lien de paiement indisponible', 'La réservation reste valide en attente d’acompte.');
      }
      setStep(4);
    } catch (e) {
      saveDraft(phone);
      setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Nouvelle réservation" sub="Quatre étapes courtes. Le brouillon est conservé sur ce téléphone en cas d’interruption." />

      <div className="card">
        <div className="steps" aria-label={`Étape ${step} sur 4 : ${STEPS[step - 1]}`}>
          {STEPS.map((s, i) => (
            <span key={s} style={{ display: 'contents' }}>
              <span className={`step-dot${i + 1 < step ? ' done' : ''}${i + 1 === step ? ' now' : ''}`}>
                <span className="n" aria-hidden="true">{i + 1 < step ? '✓' : i + 1}</span>{s}
              </span>
              {i < 3 && <span className="step-line" aria-hidden="true" />}
            </span>
          ))}
        </div>
      </div>

      {error && <div className="alert-error" role="alert"><Icon name="alert" size={18} />{error}</div>}

      {step === 1 && (
        <section className="card form" aria-label="Étape 1 : client">
          <h2>1. Client</h2>
          <Field label="Téléphone" required htmlFor="nb-phone" hint="Format international, ex. +223 78 80 30 72">
            <input id="nb-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+223…" autoComplete="tel" />
          </Field>
          <Field label="Nom (si nouveau client)" htmlFor="nb-name">
            <input id="nb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du client" autoComplete="name" />
          </Field>
          <button type="button" className="btn btn-primary" onClick={pickCustomer} disabled={busy}>
            {busy && <span className="caret" aria-hidden="true" />}Continuer
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="card" aria-label="Étape 2 : créneau">
          <h2>2. Créneau</h2>
          <p className="muted small">Client : <strong>{customer?.name}</strong> — choisissez un créneau avec des places.</p>
          <div className="slot-list" role="radiogroup" aria-label="Créneaux disponibles">
            {slots.map((s) => {
              const left = s.capacity - (used.get(s.id) ?? 0);
              const full = s.closed || left <= 0;
              return (
                <label key={s.id} className="slot" aria-checked={slotId === s.id}>
                  <input type="radio" name="slot" disabled={full} checked={slotId === s.id} onChange={() => setSlotId(s.id)} />
                  <span>
                    <strong className="num">{fmtSlot(s.start)}</strong><br />
                    <small>{full ? 'Complet — choisissez-en un autre' : `${left} place${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''} sur ${s.capacity}`}</small>
                  </span>
                </label>
              );
            })}
            {slots.length === 0 && <p>Aucun créneau publié pour le moment.</p>}
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>Retour</button>
            <button type="button" className="btn btn-primary" onClick={() => slotId && setStep(3)} disabled={!slotId}>Continuer</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card form" aria-label="Étape 3 : détails">
          <h2>3. Détails et prix</h2>
          <div className="form-2">
            <Field label="Personnes" required htmlFor="nb-persons">
              <input id="nb-persons" inputMode="numeric" value={persons} onChange={(e) => setPersons(e.target.value)} />
            </Field>
            <Field label="Quads" required htmlFor="nb-quads">
              <input id="nb-quads" inputMode="numeric" value={quads} onChange={(e) => setQuads(e.target.value)} />
            </Field>
          </div>
          <Field label="Source" required htmlFor="nb-source" hint="D’où vient la demande ? Tracé dès l’origine.">
            <select id="nb-source" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="phone">Téléphone</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="onsite">Sur place</option>
              <option value="online">En ligne</option>
            </select>
          </Field>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>Retour</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy && <span className="caret" aria-hidden="true" />}Enregistrer la réservation
            </button>
          </div>
        </section>
      )}

      {step === 4 && done && (
        <section className="card" aria-label="Récapitulatif">
          <h2>4. Récapitulatif</h2>
          <div className="row-top">
            <span className="stub num" style={{ fontSize: 'var(--text-xl)' }}>{done.code}</span>
            <StatusBadge status={done.status} />
          </div>
          <hr className="divider" />
          <div className="leader"><span>Total</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(done.total)}</strong></div>
          <div className="leader"><span>Acompte</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(done.deposit_due)}</strong></div>
          {payRef && <p className="num">Lien de paiement : {payRef}</p>}
          <div className="btn-row" style={{ marginTop: 12 }}>
            {waMe && (
              <a href={waMe} target="_blank" rel="noreferrer" className="btn btn-accent">
                <Icon name="send" size={18} />Envoyer par WhatsApp
              </a>
            )}
          </div>
        </section>
      )}
    </AppShell>
  );
}
