import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import { Field, IconButton, PageHeader } from '../components/ui';
import Icon from '../lib/icons';
import { useToast } from '../lib/toast';
import {
  activeSiteId, clearDraft, createBooking, createCustomer, createSlot, getAvailability,
  listActivities, listBookings, listCalls, listCustomers, listSites, listSlots, listVehicles,
  loadDraft, logMessage, samePhone, saveDraft,
  type Activity, type Booking, type CallItem, type Customer, type FleetAvailability,
  type Site, type Slot, type Vehicle,
} from '../lib/api';
import { fcfa, fmtSlot, norm } from '../lib/format';

const ACTIVE = ['pending_deposit', 'confirmed', 'checked_in'];
const STEPS = ['Client', 'Créneau', 'Détails', 'Récapitulatif'];

const fmtDur = (m: number): string =>
  m < 60 ? `${m} min` : `${Math.floor(m / 60)}H${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;

/* Tarifs quad adulte : 25 000 FCFA par quad pour 1 personne seule,
   majoration +5 000 si 2 personnes partagent le même quad (30 000).
   Quads enfants : Hôtel Orpheus uniquement, 1 personne par quad, prix catalogue.
   Vélos : 1 personne par vélo, prix catalogue. */
const PRICE_SOLO_QUAD = 25000;
const PRICE_DUO_QUAD = 30000;
const PRICE_DUO_EXTRA = PRICE_DUO_QUAD - PRICE_SOLO_QUAD;

const isKidsName = (v: string): boolean => {
  const n = norm(v);
  return n.includes('kid') || n.includes('enfant');
};
const isVeloName = (v: string): boolean => norm(v).includes('velo');
const isOrpheusName = (v: string): boolean => norm(v).includes('orpheus');
/* Konibabougou : quads uniquement (ni vélo électrique, ni vélo manuel). */
const isKoniName = (v: string): boolean => norm(v).includes('koni');
/* La durée est déjà dans le nom (« Quad 1H ») : ne pas la répéter. */
const nameHasDur = (v: string): boolean => /\d\s*(h|min)/i.test(v);

const occupancy = (persons: number, quads: number): { solo: number; duo: number; total: number } => {
  const duo = persons - quads;
  const solo = 2 * quads - persons;
  return { solo, duo, total: solo * PRICE_SOLO_QUAD + duo * PRICE_DUO_QUAD };
};

const splitName = (full: string): { first: string; last: string } => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
};

export default function NewBooking() {
  const link = useSiteLink();
  const [params] = useSearchParams();
  const { notify } = useToast();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState(params.get('phone') ?? '');
  const [whatsapp, setWhatsapp] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [callMatch, setCallMatch] = useState<CallItem | null>(null);
  const [siteId, setSiteId] = useState('');
  const [formuleId, setFormuleId] = useState('');
  const [slotId, setSlotId] = useState<number | null>(() => {
    const s = params.get('slot');
    return s ? Number(s) : null;
  });
  /* Lignes de commande : un groupe (ex. 30 personnes deux par deux) = plusieurs
     lignes ajustées dès le départ, avec « + » pour en ajouter. */
  const [lines, setLines] = useState<{ persons: string; quads: string }[]>([{ persons: '1', quads: '1' }]);
  const [groupSize, setGroupSize] = useState('1');
  const [source, setSource] = useState('phone');
  const [done, setDone] = useState<Booking | null>(null);
  const [waMe, setWaMe] = useState('');
  /* Main libre : l'agent crée le créneau ici même (date + heures + capacité),
     sans passer par l'écran Créneaux. */
  const [customSlot, setCustomSlot] = useState(false);
  const [cDate, setCDate] = useState('');
  const [cStart, setCStart] = useState('09:00');
  const [cEnd, setCEnd] = useState('10:00');
  const [cCap, setCCap] = useState('10');
  const [fleet, setFleet] = useState<FleetAvailability | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      listCustomers(), listSlots(), listBookings(), listActivities(),
      listSites().catch(() => [] as Site[]), listCalls().catch(() => [] as CallItem[]),
      listVehicles().catch(() => [] as Vehicle[]),
    ])
      .then(([c, s, b, a, si, cl, v]) => {
        setCustomers(c); setSlots(s); setBookings(b);
        setActivities(a); setSites(si); setCalls(cl); setVehicles(v);
        const locked = activeSiteId();
        if (si.length > 0) {
          setSiteId((prev) => prev || (locked ? String(locked) : String(si[0].id)));
        }
        const pre = params.get('slot');
        if (pre) {
          const sl = s.find((x) => x.id === Number(pre));
          const act = a.find((x) => x.id === sl?.activity);
          if (act && !locked) setSiteId(String(act.site));
        }
      })
      .catch((e: Error) => setError(e.message));
    const d = loadDraft();
    if (d && !params.get('phone')) setPhone(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Détection de la source : numéro retrouvé dans le journal → « Téléphone »
     verrouillé (non modifiable). Sinon le champ reste libre. */
  useEffect(() => {
    const hit = calls.find((c) => phone.trim() && samePhone(c.phone_number, phone));
    setCallMatch(hit ?? null);
    if (hit) setSource('phone');
  }, [phone, calls]);

  const used = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of bookings) {
      if (!ACTIVE.includes(b.status)) continue;
      m.set(b.slot, (m.get(b.slot) ?? 0) + b.persons);
    }
    return m;
  }, [bookings]);

  /* Formules du site ; créneaux du site, sans filtre formule.
     Hôtel Orpheus : quads enfants et vélos (pas de quad adulte).
     Konibabougou : quads uniquement (ni vélo électrique, ni vélo manuel).
     Les autres sites : quads adultes et vélos, pas de quads enfants. */
  const lockedSite = activeSiteId();
  const siteOptions = useMemo(
    () => (lockedSite ? sites.filter((s) => s.id === lockedSite) : sites),
    [sites, lockedSite]);
  const siteActs = useMemo(() => activities
    .filter((a) => !siteId || String(a.site) === siteId)
    .sort((x, y) => x.base_price - y.base_price), [activities, siteId]);
  const siteName = sites.find((s) => String(s.id) === siteId)?.name ?? '';
  const orpheusSite = isOrpheusName(siteName);
  const koniSite = isKoniName(siteName);
  const isQuadAdultName = (v: string): boolean => !isKidsName(v) && !isVeloName(v);
  const bookableActs = useMemo(
    () => siteActs.filter((a) => {
      if (orpheusSite) return !isQuadAdultName(a.name);
      if (koniSite) return !isKidsName(a.name) && !isVeloName(a.name);
      return !isKidsName(a.name);
    }),
    [siteActs, orpheusSite, koniSite],
  );
  const formule = bookableActs.find((a) => String(a.id) === formuleId)
    ?? bookableActs.find((a) => !norm(a.name).startsWith('creneau')) ?? bookableActs[0] ?? null;
  const visibleSlots = useMemo(() => {
    const now = Date.now();
    return slots.filter((s) => {
      const act = activities.find((a) => a.id === s.activity);
      if (!act) return false;
      if (siteId && String(act.site) !== siteId) return false;
      /* Créneau déjà passé : jamais proposé (le serveur le refuserait). */
      if (new Date(s.start).getTime() <= now) return false;
      return true;
    });
  }, [slots, activities, siteId]);

  const slotOf = (id: number | null) => slots.find((s) => s.id === id) ?? null;
  const chosenSlot = slotOf(slotId);
  const hasSlots = visibleSlots.length > 0;
  /* Sans heure proposée, le formulaire libre s'affiche directement. */
  const showCustom = customSlot || !hasSlots;
  const chosenPlates = (chosenSlot?.vehicles ?? []).map((id) => vehicles.find((v) => v.id === id)?.plate ?? '').filter(Boolean);

  useEffect(() => {
    setFleet(null);
    if (!slotId) return;
    let cancelled = false;
    getAvailability(slotId, formule?.id)
      .then((data) => { if (!cancelled) setFleet(data); })
      .catch(() => { if (!cancelled) setFleet(null); });
    return () => { cancelled = true; };
  }, [slotId, formule?.id]);
  const slotInfo = (s: Slot) => {
    const act = activities.find((a) => a.id === s.activity);
    const t = new Date(s.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const e = new Date(s.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const d = new Date(s.start).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    return `${d} ${t} – ${e}${act ? ` · ${act.name}` : ''}`;
  };

  const kidsFormule = formule ? isKidsName(formule.name) : false;
  const veloFormule = formule ? isVeloName(formule.name) : false;
  const soloLine = kidsFormule || veloFormule;

  /* Prix et validité ligne par ligne (mêmes règles que le serveur). */
  const lineState = lines.map((l) => {
    const p = Math.floor(Number(l.persons) || 0);
    const q = Math.floor(Number(l.quads) || 0);
    let err = '';
    let amount = 0;
    if (p < 1 || q < 1) {
      err = 'Personnes et quads requis (1 minimum).';
    } else if (soloLine && p !== q) {
      err = kidsFormule
        ? 'Quad enfant : 1 seule personne par quad.'
        : 'Vélo : 1 seule personne par vélo.';
    } else if (!soloLine && (q > p || p > 2 * q)) {
      err = 'Chaque quad prend 1 ou 2 personnes.';
    } else if (formule) {
      amount = soloLine ? formule.base_price * p : occupancy(p, q).total;
    }
    return { p, q, err, amount };
  });
  const totP = lineState.reduce((s, l) => s + Math.max(0, l.p), 0);
  const totQ = lineState.reduce((s, l) => s + Math.max(0, l.q), 0);
  const previewTotal = lineState.reduce((s, l) => s + l.amount, 0);
  const firstErr = lineState.find((l) => l.err)?.err ?? '';
  const linesOk = lines.length > 0 && !firstErr && totP > 0;

  function updateLine(i: number, key: 'persons' | 'quads', v: string) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [key]: v } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, soloLine ? { persons: '1', quads: '1' } : { persons: '2', quads: '1' }]);
  }
  function removeLine(i: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  }
  /* Groupe : répartit N personnes en lignes (duo + solo restant, ou 1 par 1). */
  function splitGroup() {
    const n = Math.floor(Number(groupSize) || 0);
    if (n < 1) { setError('Saisissez le nombre total de personnes du groupe.'); return; }
    setError('');
    const built: { persons: string; quads: string }[] = [];
    if (soloLine) {
      for (let k = 0; k < n; k += 1) built.push({ persons: '1', quads: '1' });
    } else {
      let left = n;
      while (left > 0) {
        const take = left >= 2 ? 2 : 1;
        built.push({ persons: String(take), quads: '1' });
        left -= take;
      }
    }
    setLines(built);
    notify('info', 'Groupe réparti', `${n} pers. → ${built.length} ligne${built.length > 1 ? 's' : ''}, ajustez au besoin.`);
  }

  function pickCustomer() {
    setError('');
    const found = customers.find((c) => samePhone(c.phone, phone));
    if (found) {
      setCustomer(found);
      const sp = splitName(found.name);
      setFirstName(sp.first); setLastName(sp.last);
      setStep(2); notify('info', 'Client retrouvé', found.name); return;
    }
    if (!firstName.trim() || !lastName.trim()) { setError('Client inconnu : saisissez son prénom et son nom pour le créer.'); return; }
    const full = `${firstName.trim()} ${lastName.trim()}`;
    setBusy(true);
    createCustomer({ name: full, phone: phone.trim(), whatsapp: whatsapp.trim() || undefined })
      .then((c) => {
        setCustomer(c);
        setStep(2);
        if (c.queued) notify('warning', 'Client consigné hors ligne', 'Il rejoindra le Hub au retour du réseau.');
        else notify('success', 'Client enregistré', c.name);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }

  /* Étape 2 → 3 : créneau existant, ou création main libre
     (même activité générique « Créneau libre » que l'écran Créneaux). */
  async function continueWithSlot() {
    setError('');
    if (!formule) { setError('Choisissez d’abord la formule.'); return; }
    if (!showCustom) {
      if (!slotId) { setError('Choisissez une heure dans la liste, ou fixez-la vous-même (bouton du bas).'); return; }
      setStep(3);
      return;
    }
    if (!cDate) { setError('Choisissez d’abord le jour.'); return; }
    const cap = Math.floor(Number(cCap));
    if (!cap || cap < 1) { setError('Nombre de places : écrivez au moins 1.'); return; }
    const start = new Date(`${cDate}T${cStart}`);
    const end = new Date(`${cDate}T${cEnd}`);
    if (!(end > start)) { setError('L’heure de retour doit être après l’heure de départ.'); return; }
    setBusy(true);
    try {
      const generic = activities.find((a) => String(a.site) === siteId && norm(a.name).startsWith('creneau'));
      if (!generic) throw new Error('Aucune activité « Créneau libre » sur ce site (catalogue).');
      const ns = await createSlot({
        activity: generic.id, start: start.toISOString(), end: end.toISOString(), capacity: cap,
      });
      setSlots((s) => [...s, ns]);
      setSlotId(ns.id);
      setCustomSlot(false);
      notify('success', 'Créneau créé', 'La réservation continue sur ce créneau.');
      setStep(3);
    } catch (e) { setError(e instanceof Error ? e.message : 'Création impossible.'); }
    finally { setBusy(false); }
  }

  async function submit() {
    setError('');
    if (!customer || !slotId || !formule) { setError('Client, créneau et formule requis.'); return; }
    if (kidsFormule && !orpheusSite) { setError('Formule enfant : uniquement sur le site Hôtel Orpheus.'); return; }
    if (veloFormule && koniSite) { setError('Site Konibabougou : quads uniquement, pas de vélos.'); return; }
    if (firstErr || !linesOk) { setError(firstErr || 'Ajoutez au moins une ligne de commande.'); return; }
    const payload = lineState.map((l) => ({ persons: l.p, quads: l.q }));
    setBusy(true);
    try {
      const b = await createBooking({
        customer: customer.id, slot: slotId, activity: formule.id,
        persons: totP, quads: totQ, lines: payload, source, previewTotal,
        customerLabel: customer.name,
      });
      setDone(b);
      clearDraft();
      if (b.queued) {
        notify('warning', 'Réservation consignée hors ligne',
          `${b.code} — à synchroniser : elle n'existe pas encore dans le Hub.`);
      } else {
        notify('success', 'Réservation enregistrée', `${b.code} — paiement au comptant.`);
      }
      /* Phase 1 sans lien de paiement : code, formule, créneau, total.
         MÉMO session : réintégrer le lien (createPayLink) à l'arrivée de l'agrégateur. */
      try {
        const s = slotOf(slotId);
        const text = `Bonjour, votre réservation ${b.code} est enregistrée`
          + ` : ${formule.name}${s ? `, ${fmtSlot(s.start)}` : ''}`
          + ` (${payload.length} ligne${payload.length > 1 ? 's' : ''}).`
          + ` Total ${fcfa(b.total)} à régler sur place.`
          + ` Présentez ce code à l’arrivée. BKO Quad.`;
        const logged = await logMessage(b.id, text);
        setWaMe(logged.wa_me);
        if (b.queued) notify('info', 'Message programmé', 'Il partira au client à la synchronisation.');
      } catch {
        notify('warning', 'Message non journalisé', 'La réservation reste valide.');
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
                <span className="n" aria-hidden="true">{i + 1 < step ? '✓' : i + 1}</span><span className="lbl">{s}</span>
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
          {callMatch && (
            <div className="banner banner-success" role="status">
              <Icon name="phone" size={20} />
              <div><strong>Appel détecté dans le journal.</strong>
              <div className="small">Source « Téléphone » verrouillée à l’étape 3 (numéro retrouvé).</div></div>
            </div>
          )}
          <Field label="Téléphone" required htmlFor="nb-phone" hint="Format international, ex. +223 78 80 30 72">
            <input id="nb-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+223…" autoComplete="tel" />
          </Field>
          <Field label="Numéro WhatsApp (si différent)" htmlFor="nb-wa" hint="Pour l’envoi du récapitulatif et du reçu.">
            <input id="nb-wa" type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+223…" autoComplete="tel" />
          </Field>
          <div className="form-2">
            <Field label="Prénom (si nouveau client)" htmlFor="nb-first">
              <input id="nb-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom du client" autoComplete="given-name" />
            </Field>
            <Field label="Nom (si nouveau client)" htmlFor="nb-name">
              <input id="nb-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom du client" autoComplete="family-name" />
            </Field>
          </div>
          <button type="button" className="btn btn-primary" onClick={pickCustomer} disabled={busy}>
            {busy && <span className="caret" aria-hidden="true" />}Continuer
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="card" aria-label="Étape 2 : créneau">
          <h2>2. Site, formule et créneau</h2>
          <p className="muted small">Client : <strong>{customer?.name}</strong> — le prix vient de la formule.</p>
          {sites.length === 0 && (
            <div className="banner banner-warning" role="alert">
              <Icon name="info" size={20} />
              <div><strong>Aucun site configuré.</strong>
                <div className="small">Un administrateur doit créer les sites dans Paramètres → Sites avant toute réservation.</div></div>
            </div>
          )}
          <div className="form-2">
            <Field label="Site de réservation" required htmlFor="nb-site"
              hint={lockedSite ? 'Site actif imposé par le contexte.' : undefined}>
              <select id="nb-site" value={siteId} disabled={!!lockedSite}
                onChange={(e) => { setSiteId(e.target.value); setSlotId(null); setFormuleId(''); setCustomSlot(false); }}>
                {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Formule" required htmlFor="nb-formule" hint={orpheusSite ? 'Orpheus : quads enfants et vélos (pas de quad adulte).' : koniSite ? undefined : 'Quads adultes et vélos — quads enfants uniquement à l’Hôtel Orpheus.'}>
              <select id="nb-formule" value={formule ? String(formule.id) : ''} onChange={(e) => setFormuleId(e.target.value)}>
                {bookableActs.filter((a) => !norm(a.name).startsWith('creneau')).map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — {fmtDur(a.duration_minutes)}{isKidsName(a.name) || isVeloName(a.name) ? ` — ${a.base_price.toLocaleString('fr-FR')} FCFA` : ` — 25 000 + 5 000 (duo) FCFA`}</option>
                ))}
              </select>
            </Field>
          </div>
          {hasSlots && !customSlot && (
            <>
              <Field
                label="Heure du tour"
                required
                htmlFor="nb-slotfield"
                hint="Choisissez dans la liste des heures ouvertes par l'agence."
              >
                <select id="nb-slotfield" value={slotId === null ? '' : String(slotId)} onChange={(e) => setSlotId(Number(e.target.value))}>
                  <option value="">Choisir une heure…</option>
                  {visibleSlots.map((s) => {
                    const left = s.capacity - (used.get(s.id) ?? 0);
                    return <option key={s.id} value={s.id}>{`${slotInfo(s)} — ${left} place${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}`}</option>;
                  })}
                </select>
              </Field>
              {chosenSlot && (() => {
                const left = chosenSlot.capacity - (used.get(chosenSlot.id) ?? 0);
                return <p className="small num">Heure choisie : {slotInfo(chosenSlot)} — {left} place{left > 1 ? 's' : ''} restante{left > 1 ? 's' : ''} sur {chosenSlot.capacity}</p>;
              })()}
              {fleet && fleet.free === 0 && (
                <div className="banner banner-warning" role="alert">
                  <Icon name="alert" size={20} />
                  <div><strong>Flotte indisponible sur ce créneau.</strong>
                    <div className="small">Aucun {fleet.resource_type === 'velo' ? 'vélo' : 'quad'} libre sur {fleet.total} en service. Choisissez un autre créneau.</div></div>
                </div>
              )}
              {fleet && fleet.free > 0 && (
                <p className="small num" role="status">
                  Flotte : {fleet.free} {fleet.resource_type === 'velo' ? 'vélo' : 'quad'}{fleet.free > 1 ? 's' : ''} libre{fleet.free > 1 ? 's' : ''} sur {fleet.total} en service.
                </p>
              )}
            </>
          )}
          {hasSlots && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setCustomSlot((v) => !v)}>
                <Icon name="plus" size={18} />{customSlot ? 'Revenir aux heures proposées' : 'Aucune heure ne convient ? Fixez-la moi-même'}
              </button>
            </div>
          )}
          {showCustom && (
            <>
              <p className="small muted" style={{ marginTop: 8 }}>Écrivez le jour, l’heure où les clients partent et l’heure où ils rentent, puis le nombre de places à garder pour ce tour.</p>
              <div className="form-2" style={{ marginTop: 8 }}>
                <Field label="Jour" required htmlFor="nb-cdate">
                  <input id="nb-cdate" type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} />
                </Field>
                <Field label="Nombre de places" required htmlFor="nb-ccap" hint="Combien de clients peuvent partir à cette heure (ex. 8).">
                  <input id="nb-ccap" inputMode="numeric" value={cCap} onChange={(e) => setCCap(e.target.value)} placeholder="Ex. 8" />
                </Field>
                <Field label="Heure de départ" required htmlFor="nb-cstart">
                  <input id="nb-cstart" type="time" value={cStart} onChange={(e) => setCStart(e.target.value)} />
                </Field>
                <Field label="Heure de retour" required htmlFor="nb-cend">
                  <input id="nb-cend" type="time" value={cEnd} onChange={(e) => setCEnd(e.target.value)} />
                </Field>
              </div>
            </>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>Retour</button>
            <button type="button" className="btn btn-primary" onClick={continueWithSlot} disabled={busy || (!showCustom && (!slotId || !formule)) || (showCustom && !formule)}>
              {busy && <span className="caret" aria-hidden="true" />}{showCustom ? 'Enregistrer cette heure et continuer' : 'Continuer'}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card form" aria-label="Étape 3 : détails">
          <h2>3. Détails et prix</h2>
          <div className="banner" role="note">
            <Icon name="info" size={20} />
            <div><strong className="num">{formule?.name}{formule && !nameHasDur(formule.name) ? ` — ${fmtDur(formule.duration_minutes)}` : ''} · {sites.find((s) => String(s.id) === siteId)?.name}</strong>
            {kidsFormule ? (
              <div className="small num">Quad enfant : 1 seule personne par quad, au prix du catalogue — Total : {fcfa(previewTotal)} pour {totP} pers. et {totQ} quad{totQ > 1 ? 's' : ''}.</div>
            ) : veloFormule ? (
              <div className="small num">Vélo : 1 seule personne par vélo, {fcfa(formule?.base_price ?? 0)} × personne — Total : {fcfa(previewTotal)} pour {totP} pers. et {totQ} vélo{totQ > 1 ? 's' : ''}.</div>
            ) : (
              <div className="small num">25 000 FCFA par quad pour 1 personne seule · 30 000 FCFA si 2 personnes partagent le même quad (majoration +{PRICE_DUO_EXTRA.toLocaleString('fr-FR')} FCFA) — Total : {fcfa(previewTotal)} pour {totP} pers. et {totQ} quad{totQ > 1 ? 's' : ''}.</div>
            )}
            {chosenPlates.length > 0 && <div className="small num">Engins prévus sur le créneau (indicatif) : {chosenPlates.join(', ')}</div>}</div>
          </div>
          {fleet && totQ > fleet.free && (
            <div className="alert-error" role="alert">
              <Icon name="alert" size={18} />
              Flotte insuffisante : {totQ} {fleet.resource_type === 'velo' ? 'vélos' : 'quads'} demandés, {fleet.free} libre{fleet.free > 1 ? 's' : ''} sur ce créneau.
            </div>
          )}
          <Field label="Groupe : répartir les personnes en lignes" htmlFor="nb-group" hint={soloLine ? 'Enfant / vélo : 1 personne par engin — la répartition crée une ligne par personne.' : 'Ex. groupe de 30 : la répartition crée 15 lignes de 2 pers. / 1 quad, ajustez ensuite avec +.'}>
            <div className="line-split">
              <input id="nb-group" inputMode="numeric" value={groupSize} onChange={(e) => setGroupSize(e.target.value)} placeholder="Ex. 30" aria-label="Nombre total de personnes du groupe" />
              <button type="button" className="btn btn-ghost" onClick={splitGroup}>Répartir{soloLine ? ' un par un' : ' deux par deux'}</button>
            </div>
          </Field>
          <div>
            <div className="lines-head" aria-hidden="true">
              <span>N°</span><span>Personnes</span><span>{veloFormule ? 'Vélos' : 'Quads'}</span><span className="r">Prix</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i}>
                <div className="line-row">
                  <span className="line-num num">{i + 1}</span>
                  <input inputMode="numeric" aria-label={`Personnes, ligne ${i + 1}`} value={l.persons} onChange={(e) => updateLine(i, 'persons', e.target.value)} />
                  <input inputMode="numeric" aria-label={`${veloFormule ? 'Vélos' : 'Quads'}, ligne ${i + 1}`} value={l.quads} onChange={(e) => updateLine(i, 'quads', e.target.value)} />
                  <span className="line-total num">{fcfa(lineState[i]?.amount ?? 0)}</span>
                  {lines.length > 1 ? (
                    <IconButton icon="x" label={`Supprimer la ligne ${i + 1}`} className="danger plain" onClick={() => removeLine(i)} />
                  ) : <span />}
                </div>
                {lineState[i]?.err && <div className="alert-error" role="alert"><Icon name="alert" size={18} />Ligne {i + 1} : {lineState[i].err}</div>}
              </div>
            ))}
            <button type="button" className="btn btn-ghost" onClick={addLine} style={{ marginTop: 8 }}>
              <Icon name="plus" size={18} />Ajouter une ligne
            </button>
          </div>
          <Field label="Prix (FCFA, calculé)" htmlFor="nb-price" hint="Paiement comptant sur place. Modifiable uniquement au catalogue, jamais à la main.">
            <input id="nb-price" value={previewTotal ? `${previewTotal.toLocaleString('fr-FR')} FCFA` : ''} readOnly aria-readonly="true" />
          </Field>
          <Field label="Source" required htmlFor="nb-source" hint={callMatch ? 'Numéro retrouvé dans le journal d’appels — source « Téléphone » verrouillée.' : 'D’où vient la demande ? Tracé dès l’origine.'}>
            <select id="nb-source" value={source} onChange={(e) => setSource(e.target.value)} disabled={!!callMatch} aria-disabled={!!callMatch}>
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
            {done.queued
              ? <span className="badge badge-sync"><Icon name="clock" size={14} />À synchroniser</span>
              : <StatusBadge status={done.status} />}
          </div>
          <hr className="divider" />
          {(done.lines && done.lines.length > 0 ? done.lines : [{ rank: 1, persons: done.persons, quads: done.quads, line_total: done.total }]).map((l, i) => (
            <div className="leader" key={i}><span>Ligne {l.rank} — {l.persons} pers., {l.quads} quad{l.quads > 1 ? 's' : ''}</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(l.line_total)}</strong></div>
          ))}
          {(done.vehicle_plates && done.vehicle_plates.length > 0 ? done.vehicle_plates : chosenPlates).length > 0 && <div className="leader"><span>N° des engins</span><span className="dots" aria-hidden="true" /><strong className="num">{(done.vehicle_plates && done.vehicle_plates.length > 0 ? done.vehicle_plates : chosenPlates).join(', ')}</strong></div>}
          <div className="leader"><span>Total à régler</span><span className="dots" aria-hidden="true" /><strong className="num">{fcfa(done.total)}</strong></div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            {waMe && (
              <a href={waMe} target="_blank" rel="noreferrer" className="btn btn-accent">
                <Icon name="send" size={18} />Envoyer par WhatsApp
              </a>
            )}
            {done.queued ? (
              <span className="small muted">
                Reçu et facture à télécharger après la synchronisation (le dossier n’existe pas encore dans le Hub).
              </span>
            ) : (
              <>
                <Link to={link(`/documents/${done.id}/recu`)} className="btn btn-ghost">
                  <Icon name="file" size={18} />Reçu
                </Link>
                <Link to={link(`/documents/${done.id}/facture`)} className="btn btn-ghost">
                  <Icon name="file" size={18} />Facture
                </Link>
              </>
            )}
          </div>
          <p className="small muted">
            {done.queued
              ? 'Réservation hors ligne : elle part au Hub au retour du réseau, une seule fois. Rien n’est confirmé avant.'
              : 'Après l’envoi WhatsApp, le statut passe à « Confirmée » dès le paiement encaissé (bouton Encaisser, écran Factures).'}
          </p>
        </section>
      )}
    </AppShell>
  );
}
