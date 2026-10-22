import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { EmptyState, Field, PageHeader, SkeletonList } from '../components/ui';
import Icon from '../lib/icons';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { createMaintenance, listMaintenances, listSpareParts, listVehicles, type Maintenance, type SparePart, type Vehicle } from '../lib/api';
import { fcfa } from '../lib/format';

const KINDS: Record<string, string> = {
  vidange: 'Vidange', reparation: 'Réparation', piece: 'Changement de pièce',
  controle: 'Contrôle', pneus: 'Pneus', autre: 'Autre',
};

/* Maintenance : toutes les interventions, tous engins. Un coût crée la dépense.
   Le nouvel état pilote l'affichage sur la Flotte et bloque l'affectation. */
export default function MaintenanceList() {
  const { can } = useAuth();
  const { notify } = useToast();
  const [items, setItems] = useState<Maintenance[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vehicle, setVehicle] = useState('');
  const [kind, setKind] = useState('vidange');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState('');
  const [part, setPart] = useState('');
  const [serial, setSerial] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');
  const [oil, setOil] = useState('');
  const [qty, setQty] = useState('');
  const mayEdit = can('responsable', 'admin');

  function load() {
    setLoading(true); setError('');
    Promise.all([
      listMaintenances(),
      listVehicles().catch(() => [] as Vehicle[]),
      listSpareParts().catch(() => [] as SparePart[]),
    ])
      .then(([m, v, p]) => { setItems(m); setVehicles(v); setParts(p); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const rows = useMemo(() => items.filter((m) =>
    !q.trim() || m.plate.toLowerCase().includes(q.trim().toLowerCase()) || (m.notes ?? '').toLowerCase().includes(q.trim().toLowerCase()),
  ), [items, q]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => String(v.id) === vehicle) ?? null, [vehicles, vehicle]);
  const partMatch = useMemo(() => {
    const needle = serial.trim().toLowerCase();
    if (!needle) return null;
    return parts.find((p) => p.serial_number.toLowerCase() === needle) ?? null;
  }, [parts, serial]);

  async function submit() {
    if (!vehicle) { notify('warning', 'Engin requis', 'Choisissez l’engin concerné.'); return; }
    if (kind === 'piece' && !part.trim()) { notify('warning', 'Pièce requise', 'Nommez la pièce changée.'); return; }
    if (kind === 'piece' && !serial.trim()) {
      notify('warning', 'Numéro de série requis', 'Saisissez le numéro de série de la pièce de rechange.');
      return;
    }
    if (kind === 'piece' && !partMatch) {
      notify('warning', 'Pièce introuvable', 'Aucune pièce du stock ne porte ce numéro de série.');
      return;
    }
    if (kind === 'piece' && partMatch && selectedVehicle && partMatch.site !== selectedVehicle.site) {
      notify('warning', 'Pièce d’un autre site', `Cette pièce appartient au site ${partMatch.site_name}.`);
      return;
    }
    if (kind === 'piece' && partMatch && partMatch.status !== 'available') {
      notify('warning', 'Pièce déjà utilisée', partMatch.used_vehicle_plate
        ? `Elle a été montée sur l’engin ${partMatch.used_vehicle_plate}.`
        : 'Cette pièce a déjà servi en maintenance.');
      return;
    }
    if (kind === 'autre' && !part.trim()) { notify('warning', 'Précision requise', 'Écrivez ce qui a été fait, en une phrase.'); return; }
    if (kind === 'vidange' && oil.trim() && !(Number(oil) > 0)) { notify('warning', 'Quantité invalide', 'Huile en litres, ex. 1.5.'); return; }
    setBusy(true);
    try {
      await createMaintenance({
        vehicle: Number(vehicle), kind, date: date || new Date().toISOString().slice(0, 10),
        cost: Number(cost) || 0,
        part_name: kind === 'piece' || kind === 'autre' ? part.trim() : undefined,
        part_serial: kind === 'piece' ? serial.trim() : undefined,
        oil_liters: kind === 'vidange' && Number(oil) > 0 ? Number(oil) : null,
        quantity: (kind === 'piece' || kind === 'pneus') && Number(qty) > 0 ? Math.round(Number(qty)) : null,
        notes: notes.trim(), new_status: status || undefined,
      });
      notify('success', 'Maintenance enregistrée', Number(cost) > 0 ? 'Le coût est passé en dépense.' : 'Historique mis à jour.');
      if (kind === 'piece' && partMatch) {
        notify('info', 'Pièce sortie du stock', `${partMatch.name} — N° ${partMatch.serial_number}.`);
      }
      setOpen(false); setCost(''); setNotes(''); setStatus(''); setPart(''); setSerial(''); setOil(''); setQty('');
      load();
    } catch (e) { notify('error', 'Enregistrement impossible', e instanceof Error ? e.message : ''); }
    finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Maintenance"
        sub="Vidanges, réparations, contrôles. L’état saisi ici s’affiche sur la Flotte."
        actions={mayEdit ? <button type="button" className="btn btn-accent" onClick={() => { setSerial(''); setOpen(true); }}><Icon name="plus" size={18} />Intervention</button> : undefined}
      />
      <div className="card">
        <div className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher immatriculation ou note…" aria-label="Rechercher une intervention" />
        </div>
      </div>
      {loading && <SkeletonList n={4} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState icon="quad" title="Aucune intervention" text="L’historique d’entretien apparaîtra ici." />
      )}
      {!loading && !error && (
        <div className="list">
          {rows.map((m) => (
            <article className="row-card" key={m.id}>
              <div className="row-top">
                <span className="stub num">{m.plate}</span>
                <strong>{KINDS[m.kind] ?? m.kind}</strong>
              </div>
              <div className="row-meta">
                <span className="num">{new Date(m.date).toLocaleDateString('fr-FR')}</span>
                {m.cost > 0 && <span className="num">{fcfa(m.cost)}</span>}
                {m.new_status && <span>→ {m.new_status.replace('_', ' ')}</span>}
              </div>
              {m.notes && <div className="small">{m.notes}</div>}
              {m.part_name && <div className="small">{m.kind === 'autre' ? 'Précision' : 'Pièce'} : <strong>{m.part_name}</strong></div>}
              {m.part_serial && <div className="small num">N° de série : <strong>{m.part_serial}</strong></div>}
              {m.oil_liters && <div className="small num">Huile : <strong>{Number(m.oil_liters)} L</strong></div>}
            </article>
          ))}
        </div>
      )}
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal form" role="dialog" aria-modal="true" aria-label="Nouvelle intervention" onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle intervention</h2>
            <div className="form-2">
              <Field label="Engin" required htmlFor="mn-vehicle">
                <select id="mn-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                  <option value="">Choisir…</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.model}</option>)}
                </select>
              </Field>
              <Field label="Intervention" required htmlFor="mn-kind">
                <select id="mn-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {Object.entries(KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </div>
            <div className="form-2">
              <Field label="Date" required htmlFor="mn-date"><input id="mn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Coût (FCFA, 0 = sans coût)" htmlFor="mn-cost"><input id="mn-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /></Field>
            </div>
            <Field label="État après (vide = inchangé)" htmlFor="mn-status">
              <select id="mn-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Inchangé</option>
                <option value="en_service">En service</option>
                <option value="maintenance">En maintenance</option>
                <option value="hors_service">Hors service</option>
              </select>
            </Field>
            <Field label="Notes" htmlFor="mn-notes"><input id="mn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. plaquettes + vidange" /></Field>
            {kind === 'vidange' && (
              <Field label="Quantité d’huile (litres)" htmlFor="mn-oil" hint="Huile moteur versée, ex. 1.5 L.">
                <input id="mn-oil" inputMode="decimal" value={oil} onChange={(e) => setOil(e.target.value)} placeholder="Ex. 1.5" />
              </Field>
            )}
            {kind === 'piece' && (
              <>
                <Field label="Nom de la pièce" required htmlFor="mn-part" hint="Ex. kit embrayage, plaquettes avant.">
                  <input id="mn-part" value={part} onChange={(e) => setPart(e.target.value)} placeholder="Nom de la pièce changée" />
                </Field>
                <Field label="Numéro de série de la pièce" required htmlFor="mn-serial"
                  hint="Obligatoire : la pièce doit exister dans le stock du même site.">
                  <input id="mn-serial" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Ex. KE-2026-0042" />
                </Field>
                {serial.trim() !== '' && (
                  partMatch ? (
                    partMatch.status !== 'available' ? (
                      <div className="alert-error" role="alert">
                        <Icon name="alert" size={18} />
                        Pièce déjà utilisée{partMatch.used_vehicle_plate ? ` sur l’engin ${partMatch.used_vehicle_plate}` : ''}.
                      </div>
                    ) : selectedVehicle && partMatch.site !== selectedVehicle.site ? (
                      <div className="alert-error" role="alert">
                        <Icon name="alert" size={18} />
                        Cette pièce appartient au site {partMatch.site_name}, pas à celui de l’engin.
                      </div>
                    ) : (
                      <div className="part-match" role="status">
                        <Icon name="check" size={18} />
                        <span>
                          <strong>{partMatch.name}</strong> · N° {partMatch.serial_number}
                          {partMatch.color ? ` · ${partMatch.color}` : ''}
                          {' — '}<strong>en stock</strong> ({partMatch.site_name})
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="small muted" role="status">
                      Aucune pièce en stock avec ce numéro de série. Enregistrez-la d’abord dans le stock de la Flotte.
                    </div>
                  )
                )}
                <Field label="Nombre" htmlFor="mn-qty" hint="Pièces changées, ex. 2 plaquettes.">
                  <input id="mn-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Ex. 1" />
                </Field>
              </>
            )}
            {kind === 'pneus' && (
              <Field label="Nombre de pneus" required htmlFor="mn-qty" hint="Ex. 1 (avant), 2 (les deux).">
                <input id="mn-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Ex. 2" />
              </Field>
            )}
            {kind === 'autre' && (
              <Field label="Précision de l’intervention" required htmlFor="mn-part" hint="Écrivez en une phrase ce qui a été fait, ex. soudure du porte-bagage.">
                <input id="mn-part" value={part} onChange={(e) => setPart(e.target.value)} placeholder="Qu’est-ce qui a été fait ?" />
              </Field>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Revenir</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
                {busy && <span className="caret" aria-hidden="true" />}Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
