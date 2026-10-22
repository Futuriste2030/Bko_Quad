import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteLink } from '../lib/sitepath';
import AppShell from '../components/AppShell';
import { ConfirmDialog, EmptyState, Field, IconButton, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { createSlot, deleteSlot, listActivities, listBookings, listSites, listSlots, listVehicles, updateSlotVehicles, type Activity, type Booking, type Site, type Slot, type Vehicle } from '../lib/api';
import { norm } from '../lib/format';

function dayLabel(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export default function Slots() {
  const link = useSiteLink();
  const { can } = useAuth();
  const { notify } = useToast();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [slotSite, setSlotSite] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assign, setAssign] = useState<Slot | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delTarget, setDelTarget] = useState<Slot | null>(null);
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [capacity, setCapacity] = useState('10');
  const mayCreate = can('responsable', 'admin');

  function load() {
  setLoading(true); setError('');
    Promise.all([listSlots(), listActivities(), listBookings().catch(() => [] as Booking[]), listVehicles().catch(() => [] as Vehicle[]), listSites().catch(() => [] as Site[])])
      .then(([s, a, b, v, si]) => {
        setSlots(s); setActivities(a); setBookings(b); setVehicles(v); setSites(si);
        if (si.length > 0) setSlotSite((prev) => prev || String(si[0].id));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const days = useMemo(() => {
    const m = new Map<string, { date: Date; slots: Slot[] }>();
    for (const s of slots.slice(0, 60)) {
  const d = new Date(s.start);
      const key = d.toLocaleDateString('fr-FR');
      if (!m.has(key)) m.set(key, { date: d, slots: [] });
      m.get(key)!.slots.push(s);
    }
    return [...m.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 14);
  }, [slots]);

  const actName = (id: number) => activities.find((a) => a.id === id)?.name ?? 'Activité';
  const everBooked = (id: number) => bookings.some((b) => b.slot === id);
  const plateOf = (id: number) => vehicles.find((v) => v.id === id)?.plate ?? `#${id}`;
  const platesOf = (s: Slot) => (s.vehicles ?? []).map(plateOf);
  const loadOf = (id: number) => bookings
    .filter((b) => b.slot === id && ['pending_deposit', 'confirmed', 'checked_in'].includes(b.status))
    .reduce((s, b) => s + b.persons, 0);

  async function submit() {
  /* Créneau libre : date + heures, sans choix d'activité (générique du site). */
    if (!slotSite || !date) { notify('warning', 'Site et date requis', 'Choisissez le site et le jour du créneau.'); return; }
    const cap = Number(capacity);
    if (!cap || cap < 1) { notify('warning', 'Capacité invalide', 'Saisissez au moins 1 place.'); return; }
    setBusy(true);
    try {
      const generic = activities.find((a) => String(a.site) === slotSite && norm(a.name).startsWith('creneau'));
      if (!generic) throw new Error('Aucune activité Â« Créneau libre Â» sur ce site (catalogue).');
      await createSlot({
        activity: generic.id,
        start: new Date(`${date}T${start}`).toISOString(),
        end: new Date(`${date}T${end}`).toISOString(),
        capacity: cap,
      });
      notify('success', 'Créneau créé', 'Visible dans le calendrier et le parcours de réservation.');
      setOpen(false);
      load();
    } catch (e) { notify('error', 'Création impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  function togglePick(id: number) {
  setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function removeSlot() {
  if (!delTarget) return;
    setBusy(true);
    try { await deleteSlot(delTarget.id); notify('success', 'Créneau supprimé', 'Il disparaît du calendrier et du parcours de réservation.'); setDelTarget(null); load(); }
    catch (e) { notify('error', 'Suppression impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  async function saveQuads() {
  if (!assign) return;
    setBusy(true);
    try {
      await updateSlotVehicles(assign.id, picked);
      notify('success', 'Quads affectés', 'Hors service exclus automatiquement par le serveur.');
      setAssign(null);
      load();
    } catch (e) { notify('error', 'Affectation impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  const assignChoices = (() => {
    if (!assign) return [];
    const act = activities.find((a) => a.id === assign.activity);
    return vehicles.filter((v) => v.status === 'en_service' && (!act || v.site === act.site));
  })();

  return (
    <AppShell>
      <PageHeader
        title="Créneaux"
        sub="Colonnes par jour, remplissage en direct. La capacité est verrouillée côté serveur."
        actions={mayCreate ? <button type="button" className="btn btn-accent" onClick={() => setOpen(true)}><Icon name="plus" size={18} />Nouveau créneau</button> : undefined}
      />
      {loading && <SkeletonList n={3} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && days.length === 0 && (
        <EmptyState icon="clock" title="Aucun créneau publié" text="Créez le premier créneau pour ouvrir la réservation." />
      )}
      {!loading && !error && (
        <div className="kanban">
          {days.map((g) => (
            <section className="kanban-col" key={g.date.toISOString()} aria-label={dayLabel(g.date)}>
              <h2 className="num">{dayLabel(g.date)}</h2>
              <div className="stack">
                {g.slots.map((s) => {
                  const used = loadOf(s.id);
                  const left = s.capacity - used;
                  const pct = Math.min(100, Math.round((used / Math.max(1, s.capacity)) * 100));
                  const t = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <article className="row-card" key={s.id}>
                      <div className="row-top">
                        <strong className="num">{t(s.start)} – {t(s.end)}</strong>
                        {s.closed && <span className="badge badge-expired">Fermé</span>}
                      </div>
                      <div className="small muted">{actName(s.activity)}</div>
                      {platesOf(s).length > 0 && (
                        <div className="small num">Quads : {platesOf(s).join(', ')}</div>
                      )}
                      <div className="row-meta"><span className="num">{used} inscrits · {left} restantes</span></div>
                      <div style={{ height: 6, borderRadius: 4, background: 'var(--surface-2)' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: left <= 0 ? 'var(--danger)' : 'var(--ink)' }} />
                      </div>
                      <div className="btn-row">
                        {!s.closed && left > 0 && (
                          <Link to={link(`/reservations/nouvelle?slot=${s.id}`)} className="btn btn-sm btn-ghost">Réserver</Link>
                        )}
                        {mayCreate && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setAssign(s); setPicked(s.vehicles ?? []); }}>
                            Quads ({(s.vehicles ?? []).length})
                          </button>
                        )}
                        {mayCreate && !everBooked(s.id) && (
                          <IconButton icon="x" label={`Supprimer le créneau de ${t(s.start)}`} className="danger plain" onClick={() => setDelTarget(s)} />
                        )}
                        {mayCreate && everBooked(s.id) && used === 0 && (
                          <span className="badge badge-expired" title="L'historique des réservations (annulé, absent, expiré) est conservé pour la piste d'audit.">Archivé</span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {delTarget && (
        <ConfirmDialog
          title={`Supprimer le créneau de ${dayLabel(new Date(delTarget.start))} ${new Date(delTarget.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} ?`}
          text="Il disparaîtra du calendrier et du parcours de réservation. Impossible s'il a déjà des réservations."
          confirmLabel="Supprimer le créneau" danger busy={busy}
          onConfirm={removeSlot}
          onClose={() => !busy && setDelTarget(null)}
        />
      )}
      {assign && (
        <div className="modal-backdrop" onClick={() => !busy && setAssign(null)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Quads du créneau" onClick={(e) => e.stopPropagation()}>
            <h2>Quads du créneau</h2>
            <p className="small muted">Seuls les engins en service du même site sont proposés.</p>
            <div className="slot-list">
              {assignChoices.map((v) => (
                <label key={v.id} className="slot" aria-checked={picked.includes(v.id)}>
                  <input type="checkbox" checked={picked.includes(v.id)} onChange={() => togglePick(v.id)} />
                  <span><strong className="num">{v.plate}</strong><br /><small>{v.model}{v.color ? ` Â· ${v.color}` : ''}</small></span>
                </label>
              ))}
              {assignChoices.length === 0 && <p>Aucun quad en service sur ce site. Voyez la Flotte.</p>}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAssign(null)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={saveQuads} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Affecter ({picked.length})
              </button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouveau créneau" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau créneau</h2>
            <p className="small muted">Date et heures libres — la formule (et son prix) se choisit à la réservation.</p>
            <Field label="Site" required htmlFor="sl-site">
              <select id="sl-site" value={slotSite} onChange={(e) => setSlotSite(e.target.value)}>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="form-2">
              <Field label="Jour" required htmlFor="sl-date"><input id="sl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Capacité" required htmlFor="sl-cap"><input id="sl-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
              <Field label="Début" required htmlFor="sl-start"><input id="sl-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="Fin" required htmlFor="sl-end"><input id="sl-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Créer le créneau
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
